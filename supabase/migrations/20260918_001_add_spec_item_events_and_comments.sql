-- ============================================================================
-- Обсуждение и история позиции спецификации (spec_items)
-- ============================================================================
--
-- Добавляются две таблицы:
--
--   * spec_item_events   — системные события позиции (append-only журнал);
--   * spec_item_comments — пользовательские комментарии с ответами.
--
-- Почему две таблицы, а не одна «лента»: у событий и комментариев разная
-- природа. Событие — неизменяемая запись факта («цена 12 000 → 15 500»),
-- оно не редактируется и не удаляется. Комментарий — пользовательский
-- контент: он редактируется, удаляется мягко и имеет ответы. Общая таблица
-- допускала бы невалидные состояния (событие с текстом, ответ на системное
-- событие), а единая лента собирается на чтении — объединение дешёвое.
--
-- Контекст архитектуры, важный для решений ниже:
--
--   * приложение ходит в БД через service role (server actions) и RLS
--     обходит. Политики здесь — второй контур защиты Data API от имени
--     authenticated, ровно как у spec_item_components (20260906_002);
--   * приложение использует next-auth, а не Supabase Auth, поэтому auth.uid()
--     при вызове из server actions ВСЕГДА NULL. Отсюда следствие: события
--     пишет серверный код, а не триггеры — триггер не смог бы определить
--     актора. Эта миграция намеренно не создаёт ни одного триггера;
--   * автор события/комментария дублируется снимком имени: пользователя
--     могут переименовать, а organization_members — удалить (тогда FK на
--     users обнулится через ON DELETE SET NULL), и лента не должна терять
--     подпись. Паттерн тот же, что у company_name_snapshot и
--     contact_name_snapshot в spec_items.
--
-- Подключение событий к существующим actions (recordEvent) и UI — отдельные
-- этапы; здесь только схема, ограничения, индексы и RLS.

-- ---------------------------------------------------------------------------
-- 1. spec_item_events — журнал системных событий позиции
-- ---------------------------------------------------------------------------

create table public.spec_item_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  spec_item_id uuid not null,
  kind text not null,
  actor_id uuid,
  actor_name_snapshot text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint spec_item_events_org_id_fkey
    foreign key (org_id) references public.organizations (id),
  -- Позиция удаляется мягко (spec_items.deleted_at), поэтому каскад сработает
  -- только при физическом удалении — например, вместе с организацией.
  constraint spec_item_events_spec_item_id_fkey
    foreign key (spec_item_id) references public.spec_items (id)
    on delete cascade,
  constraint spec_item_events_actor_id_fkey
    foreign key (actor_id) references public.users (id)
    on delete set null,

  -- Закрытый список типов первой версии. Значения совпадают с
  -- SPEC_ITEM_EVENT_KINDS в lib/spec/history.ts — при добавлении нового
  -- события править нужно оба места (инвариант закреплён тестом
  -- lib/spec/history.test.ts).
  constraint spec_item_events_kind_check
    check (
      kind in (
        'created',
        'filled',
        'cleared',
        'removed',
        'restored',
        'code_changed',
        'status_changed',
        'price_changed',
        'quantity_changed',
        'supplier_changed',
        'details_changed',
        'variant_added',
        'variant_switched',
        'component_added',
        'component_removed',
        'service_added',
        'service_completed',
        'service_removed'
      )
    )
);

-- Основной запрос ленты: события одной позиции, свежие сверху.
create index spec_item_events_spec_item_id_created_at_idx
  on public.spec_item_events (spec_item_id, created_at desc);

-- org_id: тот же паттерн, что у остальных таблиц организации; нужен для
-- выборок уровня организации и для проверок в RLS-политике.
create index spec_item_events_org_id_idx
  on public.spec_item_events (org_id);

comment on table public.spec_item_events is
  'Системные события позиции спецификации. Append-only: строки не обновляются и не удаляются.';
comment on column public.spec_item_events.kind is
  'Тип события. CHECK-список синхронизирован с SPEC_ITEM_EVENT_KINDS (lib/spec/history.ts).';
comment on column public.spec_item_events.actor_name_snapshot is
  'Имя автора на момент события: пользователя могут переименовать, а членство — удалить.';
comment on column public.spec_item_events.payload is
  'Данные события («что изменилось»): состав зависит от kind. Позволяет построить текст без чтения прежнего состояния.';

-- ---------------------------------------------------------------------------
-- 2. spec_item_comments — комментарии и ответы
-- ---------------------------------------------------------------------------

create table public.spec_item_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  spec_item_id uuid not null,
  parent_id uuid,
  root_id uuid,
  author_id uuid,
  author_name_snapshot text,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,

  constraint spec_item_comments_org_id_fkey
    foreign key (org_id) references public.organizations (id),
  constraint spec_item_comments_spec_item_id_fkey
    foreign key (spec_item_id) references public.spec_items (id)
    on delete cascade,
  -- Ответы удаляются вместе с родителем: осиротевшая ветка в ленте смысла
  -- не имеет, а «мягкое» удаление корня оставляет плейсхолдер (deleted_at).
  constraint spec_item_comments_parent_id_fkey
    foreign key (parent_id) references public.spec_item_comments (id)
    on delete cascade,
  constraint spec_item_comments_author_id_fkey
    foreign key (author_id) references public.users (id)
    on delete set null,

  -- Пустой комментарий — не контент. Верхняя граница длины намеренно не
  -- задана здесь: её определяет валидация server action (zod), а схема не
  -- должна ломаться от смены продуктового лимита.
  constraint spec_item_comments_body_check
    check (char_length(btrim(body)) > 0)
);

-- Лента позиции: корневые и ответы вперемешку, свежие сверху.
create index spec_item_comments_spec_item_id_created_at_idx
  on public.spec_item_comments (spec_item_id, created_at desc);

-- Ветка обсуждения: все ответы одного корня по порядку.
create index spec_item_comments_spec_item_id_root_id_created_at_idx
  on public.spec_item_comments (spec_item_id, root_id, created_at);

-- Прямые ответы на комментарий (для счётчика ответов и вложенного рендера).
create index spec_item_comments_parent_id_created_at_idx
  on public.spec_item_comments (parent_id, created_at);

comment on table public.spec_item_comments is
  'Комментарии к позиции спецификации. Ответы — через parent_id, ветка — через root_id. Удаление мягкое (deleted_at).';
comment on column public.spec_item_comments.root_id is
  'Корень ветки. FK намеренно не задан: связь логическая, а не структурная (значение проставляет server action).';
comment on column public.spec_item_comments.author_name_snapshot is
  'Имя автора на момент написания: см. spec_item_events.actor_name_snapshot.';

-- ---------------------------------------------------------------------------
-- 3. RLS: второй контур защиты Data API
-- ---------------------------------------------------------------------------
-- Приложение работает через service role (server actions), для которого RLS
-- не является преградой; политики закрывают прямой доступ к данным от имени
-- authenticated. Проверка доступа — как у spec_item_components: членство в
-- организации строки плюс сверка org_id с родительской позицией (внешний
-- ключ не гарантирует «одна организация на всю цепочку»).
--
-- Замечание на будущее: подзапрос читает public.spec_items напрямую. Это
-- работает, пока у spec_items не включён RLS (сейчас политик у неё нет).
-- Если RLS на spec_items появится, политики ниже нужно переписать так же,
-- как политики spec_item_components — они устроены идентично.

-- ── spec_item_events ───────────────────────────────────────────────────────

alter table public.spec_item_events enable row level security;

-- Чтение — участникам организации.
drop policy if exists "spec_item_events_select_own_org" on public.spec_item_events;
create policy "spec_item_events_select_own_org"
  on public.spec_item_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_events.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_events.org_id
        and s.org_id = spec_item_events.org_id
    )
  );

-- INSERT/UPDATE/DELETE политик НЕТ — и это осознанное решение, а не пропуск.
-- Журнал append-only и пишется только серверным кодом (service role, который
-- RLS обходит). Прямая запись через Data API от имени authenticated
-- запрещена: клиент не должен иметь возможности подделать автора и вид
-- события. Появится серверная операция, требующая записи от пользователя, —
-- политику добавим вместе с ней.

-- ── spec_item_comments ─────────────────────────────────────────────────────

alter table public.spec_item_comments enable row level security;

-- Чтение — участникам организации.
drop policy if exists "spec_item_comments_select_own_org" on public.spec_item_comments;
create policy "spec_item_comments_select_own_org"
  on public.spec_item_comments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_comments.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_comments.org_id
        and s.org_id = spec_item_comments.org_id
    )
  );

-- Создание — участникам с правом записи: наблюдатель (viewer) прав записи не
-- имеет по матрице lib/permissions.ts (граница record:create, минимум member).
-- Отдельного права «комментирование» в матрице пока нет, и новая система
-- прав здесь не вводится — используется существующий enum org_role.
-- author_id = auth.uid() не даёт подписать комментарий чужим именем.
drop policy if exists "spec_item_comments_insert_member" on public.spec_item_comments;
create policy "spec_item_comments_insert_member"
  on public.spec_item_comments
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_comments.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_comments.org_id
        and s.org_id = spec_item_comments.org_id
    )
  );

-- Правка и удаление — только автору. Матрица прав на комментарии ещё не
-- определена (роли admin/owner сюда намеренно не заложены), поэтому политика
-- узкая и будет пересмотрена вместе с permissions. Требование членства
-- оставлено: исключённый из организации автор теряет доступ к своим записям.
drop policy if exists "spec_item_comments_update_author" on public.spec_item_comments;
create policy "spec_item_comments_update_author"
  on public.spec_item_comments
  for update
  to authenticated
  using (
    author_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_comments.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_comments.org_id
        and s.org_id = spec_item_comments.org_id
    )
  )
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_comments.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_comments.org_id
        and s.org_id = spec_item_comments.org_id
    )
  );

drop policy if exists "spec_item_comments_delete_author" on public.spec_item_comments;
create policy "spec_item_comments_delete_author"
  on public.spec_item_comments
  for delete
  to authenticated
  using (
    author_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_comments.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_comments.org_id
        and s.org_id = spec_item_comments.org_id
    )
  );
