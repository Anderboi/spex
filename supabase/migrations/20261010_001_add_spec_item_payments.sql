-- ============================================================================
-- Фактические оплаты позиции: public.spec_item_payments
-- ============================================================================
--
-- Факт оплаты — самостоятельная запись о деньгах, которые организация
-- действительно заплатила (или вернула) по позиции. Он НЕ выводится из стоимости
-- позиции (`spec_items.price × qty`), не пересчитывается при её изменении и
-- ничего не переписывает в графике: план и факт — две независимые величины,
-- остаток считается между ними (`.scratch/material-payments/REPORT.md`, §5,
-- ADR docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md).
--
-- ── Состояние живой БД, из которого исходит файл ───────────────────────────
--
-- Таблица `spec_item_payments` в linked-проекте УЖЕ создана (черновиком
-- `.scratch/material-payments/migration-draft.sql`, раздел 2), и в ней уже есть
-- составной внешний ключ, индексы, триггеры, RLS-политики и запрет каскадного
-- удаления. Не хватает одного, что видно проверкой: КОЛОНКИ ВИДА ЗАПИСИ
-- `kind` (`select kind from spec_item_payments` → `42703 column does not
-- exist`). Поэтому файл написан идемпотентно и ЦЕЛИКОМ описывает модель:
-- существующие объекты он не трогает, отсутствующие создаёт. Повторный
-- `db push` ничего не сломает.
--
-- ── Вид записи ─────────────────────────────────────────────────────────────
--
-- `kind` (`payment` | `refund`) при положительной сумме: возврат — это вид
-- записи, а не знак суммы (решение O1). Знак легко прочитать неверно, а
-- «оплачено» превращается в сальдо неизвестного происхождения; с отдельным
-- видом возврат виден в истории явной строкой, а CHECK `amount > 0` остаётся.
-- Значение по умолчанию — `payment`: все уже существующие строки (их нет, но
-- файл обязан быть безопасным) — именно оплаты.
--
-- ── Идемпотентность ────────────────────────────────────────────────────────
--
-- Ключ идемпотентности приходит от клиента (форма генерирует его на открытие) и
-- уникален в пределах организации среди ВСЕХ строк с непустым ключом — включая
-- мягко удалённые: повторный запрос (двойное нажатие, ретрай) находит уже
-- созданную запись и возвращает её, а не создаёт вторую. Это делает ЧАСТИЧНЫЙ
-- уникальный индекс, а не проверка в приложении: гонку двух одновременных
-- запросов ловит только БД. Мягко удалённая строка ключ не освобождает —
-- иначе повтор запроса, пришедший после отмены оплаты, воскресил бы её.
--
-- ── Запрет каскадного удаления ─────────────────────────────────────────────
--
-- Все три ссылки (`org_id`, `project_id`, `spec_item_id`) — `RESTRICT`, как у
-- графика (AD: docs/adr/0004-finansovaya-istoriya-ne-udlyaetsya-kaskadom.md):
-- финансовая история не исчезает каскадом. Штатный путь удаления позиции и
-- проекта — `deleted_at`; физическое удаление с непустыми оплатами падает
-- ошибкой FK и показывает пользователю понятный текст
-- (`actions/spec-item-payment-plans.ts`, `lib/spec/payment-plan-mutations.ts`).
--
-- ── Составной внешний ключ «факт → строка графика той же позиции» ──────────
--
--   foreign key (payment_plan_id, spec_item_id)
--     references spec_item_payment_plans (id, spec_item_id)
--
-- Он закрывает сразу три требования: оплата может ссылаться только на строку
-- графика СВОЕЙ позиции; при `payment_plan_id is null` ограничение не
-- проверяется (`MATCH SIMPLE`), поэтому оплата без плана разрешена; защита
-- работает при конкурентных запросах, потому что это ограничение БД, а не
-- проверка в коде, которую можно обойти гонкой.
--
-- Продуктовые таблицы не меняются. Виды событий `payment_added` /
-- `payment_changed` / `payment_removed` объявлены предыдущей миграцией
-- (`20261009_001`, раздел 3) — CHECK `spec_item_events_kind_check` расширять
-- здесь не нужно.
--
-- Применение: `npx supabase db push`.

begin;

-- ---------------------------------------------------------------------------
-- 1. Денормализация org_id/project_id и снимки
-- ---------------------------------------------------------------------------
-- Прецедент: `spec_items_sync_org()` и `payment_plan_sync_scope()`: BEFORE
-- INSERT/UPDATE подтягивает организацию и проект из позиции. Расхождение
-- «оплата в одной организации, позиция в другой» невозможно даже при
-- конкурентных запросах, поэтому проверять это в приложении нечего.
--
-- Снимки (`code_snapshot`, `name_snapshot`, `project_title_snapshot`,
-- `author_name_snapshot`) пишутся ОДИН раз, при создании записи: правка позиции
-- или переименование проекта задним числом не переписывают историю платежа —
-- ровно то же правило, по которому цена и количество не влияют на сохранённые
-- суммы (REPORT §6.2). Имя автора берётся из `users` здесь, а не клиентом: в
-- ленте должно стоять имя, а не то, что прислала форма.
create or replace function public.payment_sync_scope()
returns trigger
language plpgsql
as $function$
declare
  v_org     uuid;
  v_project uuid;
  v_code    text;
  v_name    text;
  v_title   text;
begin
  select s.org_id, s.project_id, s.code, s.name, p.title
    into v_org, v_project, v_code, v_name, v_title
    from public.spec_items s
    join public.projects p on p.id = s.project_id
   where s.id = new.spec_item_id;

  if v_org is null then
    raise exception 'SPEC_ITEM_NOT_FOUND';
  end if;

  new.org_id     := v_org;
  new.project_id := v_project;

  if tg_op = 'INSERT' then
    new.code_snapshot          := v_code;
    new.name_snapshot          := v_name;
    new.project_title_snapshot := v_title;
    if new.created_by is not null and new.author_name_snapshot is null then
      select u.name into new.author_name_snapshot
        from public.users u
       where u.id = new.created_by;
    end if;
  end if;

  return new;
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. Таблица фактических оплат
-- ---------------------------------------------------------------------------
create table if not exists public.spec_item_payments (
  id              uuid primary key default gen_random_uuid(),

  -- Денормализация для прав доступа и выборок уровня организации/проекта.
  -- Заполняется триггером, а не клиентом: значения из формы здесь не читаются.
  org_id          uuid not null,
  project_id      uuid not null,
  spec_item_id    uuid not null,

  -- Необязательная связь со строкой графика: оплата без плана разрешена и
  -- считается отдельно («оплачено вне графика»).
  payment_plan_id uuid,

  kind            text          not null default 'payment',  -- payment | refund
  amount          numeric(12,2) not null,
  paid_at         date          not null default current_date,
  comment         text,
  -- Реквизитов платежа (номер счёта, поручения, скан) здесь нет намеренно:
  -- документ — отдельная задача (решение O10), и колонка-заглушка её бы не
  -- заменила.

  created_by      uuid,
  author_name_snapshot   text,
  code_snapshot          text,
  name_snapshot          text,
  project_title_snapshot text,

  -- Ключ идемпотентности от клиента. NULL — «без защиты от повтора»: так
  -- выглядят строки, созданные в обход формы, и запрещать их незачем.
  idempotency_key uuid,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Удаление мягкое (прецедент — spec_item_files, spec_item_comments):
  -- ошибочная проводка не исчезает из истории, а перестаёт считаться в суммах.
  deleted_at      timestamptz,

  constraint spec_item_payments_kind_check
    check (kind in ('payment', 'refund')),
  -- Сумма положительна у обоих видов: знак — не способ выразить возврат.
  constraint spec_item_payments_amount_check
    check (amount > 0),
  constraint spec_item_payments_comment_check
    check (comment is null or char_length(btrim(comment)) > 0)
);

-- Колонка вида записи добавляется отдельно: таблица могла быть создана более
-- ранним прогоном черновика (так и есть в живом проекте — колонки `kind` там
-- нет, проверено запросом). `not null default 'payment'` безопасен для
-- существующих строк: незаполненный вид читается как оплата.
alter table public.spec_item_payments
  add column if not exists kind text not null default 'payment';

-- Ограничения добавляются только если их ещё нет: имя в уже применённой версии
-- могло быть другим, поэтому проверяется наличие ЛЮБОГО check по колонке.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.spec_item_payments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  ) then
    alter table public.spec_item_payments
      add constraint spec_item_payments_kind_check
      check (kind in ('payment', 'refund'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.spec_item_payments'::regclass
       and conname = 'spec_item_payments_amount_check'
  ) then
    alter table public.spec_item_payments
      add constraint spec_item_payments_amount_check
      check (amount > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.spec_item_payments'::regclass
       and conname = 'spec_item_payments_comment_check'
  ) then
    alter table public.spec_item_payments
      add constraint spec_item_payments_comment_check
      check (comment is null or char_length(btrim(comment)) > 0);
  end if;
end $$;

-- Внешние ключи: `RESTRICT` у организации, проекта и позиции (ADR 0004),
-- `created_by` — `SET NULL`, как у автора события (запись переживает удаление
-- пользователя). Добавляются по колонке, а не по имени: имя в уже применённой
-- версии могло быть любым.
do $$
declare
  missing text;
begin
  foreach missing in array array['org_id', 'project_id', 'spec_item_id', 'created_by']
  loop
    if not exists (
      select 1
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = any (c.conkey)
       where c.conrelid = 'public.spec_item_payments'::regclass
         and c.contype = 'f'
         and a.attname = missing
    ) then
      execute format(
        'alter table public.spec_item_payments
           add constraint spec_item_payments_%1$s_fkey
           foreign key (%1$I) references %2$s (id) %3$s',
        missing,
        case missing
          when 'org_id' then 'public.organizations'
          when 'project_id' then 'public.projects'
          when 'spec_item_id' then 'public.spec_items'
          else 'public.users'
        end,
        case missing
          when 'created_by' then 'on delete set null'
          else 'on delete restrict'
        end
      );
    end if;
  end loop;
end $$;

-- Составной ключ: цель — уникальная пара (id, spec_item_id) у графика. Проверка
-- по определению ограничения, а не по имени: без неё создание FK ниже упало бы
-- на несуществующей цели, а с ней повторный прогон файла безопасен.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.spec_item_payment_plans'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) like '%(id, spec_item_id)%'
  ) then
    alter table public.spec_item_payment_plans
      add constraint spec_item_payment_plans_id_item_key unique (id, spec_item_id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.spec_item_payments'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) like '%payment_plan_id, spec_item_id%'
  ) then
    -- `MATCH SIMPLE` (по умолчанию): при `payment_plan_id is null` ограничение
    -- не проверяется, поэтому оплата без плана разрешена.
    alter table public.spec_item_payments
      add constraint spec_item_payments_plan_same_item_fkey
      foreign key (payment_plan_id, spec_item_id)
      references public.spec_item_payment_plans (id, spec_item_id)
      on delete restrict;
  end if;
end $$;

-- Уникальность ключа идемпотентности: повтор запроса не создаёт вторую оплату.
-- Индекс частичный — строки без ключа (созданные в обход формы) его не занимают.
create unique index if not exists spec_item_payments_idempotency_uidx
  on public.spec_item_payments (org_id, idempotency_key)
  where idempotency_key is not null;

-- Основной запрос вкладки: активные оплаты одной позиции.
create index if not exists spec_item_payments_item_idx
  on public.spec_item_payments (spec_item_id) where deleted_at is null;
-- Покрытие строки графика и «покрыта ли строка целиком».
create index if not exists spec_item_payments_plan_idx
  on public.spec_item_payments (payment_plan_id) where deleted_at is null;
-- Разрез по проекту и датам (следующая задача — строка оплат в воронке).
create index if not exists spec_item_payments_project_paid_idx
  on public.spec_item_payments (project_id, paid_at);
create index if not exists spec_item_payments_org_idx
  on public.spec_item_payments (org_id);

drop trigger if exists spec_item_payments_sync_scope
  on public.spec_item_payments;
create trigger spec_item_payments_sync_scope
  before insert or update on public.spec_item_payments
  for each row execute function public.payment_sync_scope();

-- `handle_updated_at()` — живая функция проекта, переиспользуется, а не
-- переопределяется (два дублирующих хелпера `updated_at` в схеме уже есть —
-- риск R11 отчёта, третий не заводим).
drop trigger if exists set_spec_item_payments_updated_at
  on public.spec_item_payments;
create trigger set_spec_item_payments_updated_at
  before update on public.spec_item_payments
  for each row execute function public.handle_updated_at();

comment on table public.spec_item_payments is
  'Фактические оплаты и возвраты позиции. Сумма и дата — самостоятельные данные, из стоимости позиции не выводятся. Удаление мягкое (deleted_at).';
comment on column public.spec_item_payments.kind is
  'Вид записи: payment — оплата, refund — возврат. Сумма положительна у обоих видов (решение O1).';
comment on column public.spec_item_payments.payment_plan_id is
  'Строка графика, которую покрывает оплата. NULL — оплата вне графика: это допустимо и считается отдельно.';
comment on column public.spec_item_payments.paid_at is
  'Дата фактической оплаты. По умолчанию — сегодня.';
comment on column public.spec_item_payments.idempotency_key is
  'Ключ идемпотентности от клиента. Повторный запрос с тем же ключом возвращает уже созданную запись (частичный уникальный индекс spec_item_payments_idempotency_uidx).';
comment on column public.spec_item_payments.code_snapshot is
  'Код позиции на момент создания записи. Правка позиции снимок не переписывает.';

-- ---------------------------------------------------------------------------
-- 3. RLS: второй контур защиты Data API
-- ---------------------------------------------------------------------------
-- Форма предиката повторяет spec_item_files и spec_item_payment_plans:
-- членство в организации строки ПЛЮС сверка `org_id` строки с `org_id`
-- родительской позиции (внешний ключ не гарантирует «одна организация на всю
-- цепочку»).
--
-- Права (решения Q3, O9):
--   * читает любой член организации, включая `viewer` — суммы видны всем;
--   * вносит любой член, кроме `viewer`, и только от своего имени
--     (`created_by = auth.uid()`, как у комментариев);
--   * правит и отменяет СВОЮ запись автор, ЧУЖУЮ — owner/admin.
--
-- ВАЖНО: приложение ходит service-role клиентом (`lib/supabase/admin.ts`),
-- поэтому сегодня эти политики инертны — они страхуют доступ по токену
-- anon/authenticated, а не заменяют проверки в действиях. Рабочая защита —
-- в `actions/spec-item-payments.ts` (риск R3 отчёта).
alter table public.spec_item_payments enable row level security;

drop policy if exists "spec_item_payments_select_own_org"
  on public.spec_item_payments;
create policy "spec_item_payments_select_own_org"
  on public.spec_item_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_payments.org_id
        and s.org_id = spec_item_payments.org_id
    )
  );

drop policy if exists "spec_item_payments_insert_member"
  on public.spec_item_payments;
create policy "spec_item_payments_insert_member"
  on public.spec_item_payments
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payments.org_id
        and s.org_id = spec_item_payments.org_id
    )
  );

drop policy if exists "spec_item_payments_update_author_or_manager"
  on public.spec_item_payments;
create policy "spec_item_payments_update_author_or_manager"
  on public.spec_item_payments
  for update
  to authenticated
  using (
    (
      created_by = auth.uid()
      or exists (
        select 1 from public.organization_members m
         where m.user_id = auth.uid()
           and m.org_id = spec_item_payments.org_id
           and m.role in ('owner', 'admin')
      )
    )
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payments.org_id
        and s.org_id = spec_item_payments.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payments.org_id
        and s.org_id = spec_item_payments.org_id
    )
  );

drop policy if exists "spec_item_payments_delete_author_or_manager"
  on public.spec_item_payments;
create policy "spec_item_payments_delete_author_or_manager"
  on public.spec_item_payments
  for delete
  to authenticated
  using (
    (
      created_by = auth.uid()
      or exists (
        select 1 from public.organization_members m
         where m.user_id = auth.uid()
           and m.org_id = spec_item_payments.org_id
           and m.role in ('owner', 'admin')
      )
    )
    and exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payments.org_id
        and s.org_id = spec_item_payments.org_id
    )
  );

-- Права: чтение и запись только authenticated (RLS — ворота), anon не получает
-- ничего. Тот же паттерн, что у графика платежей и объектов Storage.
grant select, insert, update, delete
  on public.spec_item_payments to authenticated;
revoke all on public.spec_item_payments from anon;

-- Представлений над оплатами не создавать: `spec_items_priced` принадлежит
-- postgres и обходит RLS базовой таблицы (риск R1 отчёта).

commit;
