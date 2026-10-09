-- ============================================================================
-- График платежей позиции: public.spec_item_payment_plans
-- ============================================================================
--
-- Плановый платёж — самостоятельная величина: сумма, условие оплаты,
-- необязательный срок и порядок отображения. Она НЕ выводится из стоимости
-- позиции (`spec_items.price × qty`), не переписывается при её изменении и
-- нигде не считается оплатой. Оплаченным делает платёж только факт, а факты —
-- следующая задача (`.scratch/material-payments/REPORT.md`, раздел 5).
--
-- Контекст архитектуры, важный для решений ниже (тот же, что у
-- spec_item_files и spec_item_events):
--
--   * приложение ходит в БД через service role (server actions) и RLS
--     обходит. Политики здесь — ВТОРОЙ контур защиты Data API от имени
--     authenticated: с next-auth `auth.uid()` в проде NULL, поэтому рабочая
--     защита живёт в TS-проверках actions (`actions/spec-item-payment-plans.ts`);
--   * `org_id`/`project_id` — денормализация, и заполняет их ТРИГГЕР из
--     позиции. Расхождение «строка плана в одной организации, позиция в
--     другой» невозможно даже при конкурентных запросах, и проверять это в
--     приложении нечего (прецедент — `spec_items_sync_org()`);
--   * `on delete restrict` вместо `cascade` у соседей: финансовая история
--     каскадом не удаляется (ADR docs/adr/0004). Штатный путь удаления позиции
--     и проекта — `deleted_at`; физическое удаление с непустым графиком падает
--     ошибкой FK, а не теряет данные молча.
--
-- Продуктовые таблицы не меняются: расширяется только CHECK списка видов
-- событий у `spec_item_events` — ровно как в 20260919–20260921.
--
-- Применение: `npx supabase db push`. Миграция идемпотентна.

begin;

-- ---------------------------------------------------------------------------
-- 1. Денормализация org_id/project_id
-- ---------------------------------------------------------------------------
-- Прецедент: `spec_items_sync_org()` — BEFORE INSERT/UPDATE, подтягивает
-- `org_id` из `projects`. Здесь оба поля всегда берутся из позиции: у неё уже
-- есть и `org_id`, и `project_id`, поэтому второй источник истины не заводится.
--
-- Позиции нет — это не «тихая пустая строка»: без позиции у платежа нет ни
-- владельца, ни организации, и такая запись означала бы дыру в правах доступа.
create or replace function public.payment_plan_sync_scope()
returns trigger
language plpgsql
as $function$
declare
  v_org     uuid;
  v_project uuid;
begin
  select s.org_id, s.project_id into v_org, v_project
    from public.spec_items s
   where s.id = new.spec_item_id;

  if v_org is null then
    raise exception 'SPEC_ITEM_NOT_FOUND';
  end if;

  new.org_id     := v_org;
  new.project_id := v_project;
  return new;
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. Таблица графика платежей
-- ---------------------------------------------------------------------------
create table if not exists public.spec_item_payment_plans (
  id           uuid primary key default gen_random_uuid(),

  -- Денормализация для прав доступа и выборок уровня организации/проекта.
  -- Заполняется триггером, а не клиентом: значения из формы здесь не читаются.
  org_id       uuid not null references public.organizations (id) on delete restrict,
  project_id   uuid not null references public.projects (id)      on delete restrict,
  -- Физическое удаление позиции с непустым графиком запрещено (ADR 0004).
  spec_item_id uuid not null references public.spec_items (id)    on delete restrict,

  title        text          not null,            -- «название» из ТЗ
  amount       numeric(12,2) not null,            -- сумма плана, самостоятельная величина
  condition    text,                              -- «условие оплаты», свободный текст
  due_date     date,                              -- необязательный срок
  position     integer       not null default 0,  -- порядок отображения

  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Удаление мягкое (прецедент — spec_item_files, spec_item_comments): строка
  -- остаётся для истории, а в сумме графика и в списке её больше нет.
  deleted_at   timestamptz,

  constraint spec_item_payment_plans_title_check
    check (char_length(btrim(title)) > 0),
  -- Положительная сумма: знак — не способ выразить возврат (решение O1),
  -- а ноль в графике не значит ничего и только сбивал бы сумму.
  constraint spec_item_payment_plans_amount_check
    check (amount > 0),
  constraint spec_item_payment_plans_condition_check
    check (condition is null or char_length(btrim(condition)) > 0),

  -- Цель составного FK из фактов оплат (следующая задача): пара
  -- (план, позиция) обязана существовать, поэтому привязать оплату к строке
  -- графика ЧУЖОЙ позиции невозможно на уровне БД, а не проверкой в коде,
  -- которую можно обойти гонкой.
  constraint spec_item_payment_plans_id_item_key unique (id, spec_item_id)
);

-- Два плана не могут делить один номер порядка внутри позиции: иначе
-- «переставить строку» и «переименовать порядок» — одно и то же действие с
-- разными последствиями. Индекс частичный: мягко удалённые строки порядок не
-- занимают, иначе удаление строки запрещало бы поставить новую на её место.
create unique index if not exists spec_item_payment_plans_position_uidx
  on public.spec_item_payment_plans (spec_item_id, position)
  where deleted_at is null;

-- Основной запрос вкладки «Платежи»: активные строки одной позиции по порядку.
create index if not exists spec_item_payment_plans_item_idx
  on public.spec_item_payment_plans (spec_item_id) where deleted_at is null;
create index if not exists spec_item_payment_plans_org_idx
  on public.spec_item_payment_plans (org_id);
create index if not exists spec_item_payment_plans_project_idx
  on public.spec_item_payment_plans (project_id);

drop trigger if exists spec_item_payment_plans_sync_scope
  on public.spec_item_payment_plans;
create trigger spec_item_payment_plans_sync_scope
  before insert or update on public.spec_item_payment_plans
  for each row execute function public.payment_plan_sync_scope();

-- `handle_updated_at()` — живая функция проекта (её же вызывают триггеры
-- spec_items и соседних таблиц), поэтому здесь она только переиспользуется и
-- не переопределяется.
drop trigger if exists set_spec_item_payment_plans_updated_at
  on public.spec_item_payment_plans;
create trigger set_spec_item_payment_plans_updated_at
  before update on public.spec_item_payment_plans
  for each row execute function public.handle_updated_at();

comment on table public.spec_item_payment_plans is
  'График платежей позиции: плановые платежи (обязательства). Сумма — самостоятельная величина, из стоимости позиции не выводится. Удаление мягкое (deleted_at).';
comment on column public.spec_item_payment_plans.org_id is
  'Организация позиции. Заполняется триггером payment_plan_sync_scope() из spec_items.';
comment on column public.spec_item_payment_plans.project_id is
  'Проект позиции. Заполняется триггером payment_plan_sync_scope() из spec_items.';
comment on column public.spec_item_payment_plans.position is
  'Порядок отображения. Уникален в пределах позиции среди неудалённых строк (частичный индекс spec_item_payment_plans_position_uidx).';
comment on column public.spec_item_payment_plans.due_date is
  'Необязательный срок платежа. Просрочка считается тем же правилом, что у service_operations.deadline (lib/spec/service-operation-deadline.ts).';

-- ---------------------------------------------------------------------------
-- 3. Аудит: новые виды событий позиции
-- ---------------------------------------------------------------------------
-- Прецедент расширения списка — 20260919_001, 20260920_001, 20260921_001:
-- в Postgres нельзя добавить значение в существующий `check (kind in …)`,
-- ограничение переписывается целиком.
--
-- Список обязан совпадать с SPEC_ITEM_EVENT_KINDS (lib/spec/history.ts) —
-- рассинхрон ловит тест lib/spec/history.test.ts, который берёт ПОСЛЕДНЕЕ
-- определение ограничения по всем миграциям.
--
-- Виды фактов (`payment_added`, `payment_changed`, `payment_removed`) сюда НЕ
-- входят: таблицы фактических оплат эта миграция не создаёт, а вид события без
-- своего действия в журнале был бы мёртвым значением.
alter table public.spec_item_events
  drop constraint if exists spec_item_events_kind_check;

alter table public.spec_item_events
  add constraint spec_item_events_kind_check
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
      'parent_changed',
      'variant_added',
      'variant_switched',
      'variant_updated',
      'variant_removed',
      'component_added',
      'component_removed',
      'service_added',
      'service_completed',
      'service_removed',
      -- График платежей: добавление, изменение и удаление строки плана.
      'payment_plan_added',
      'payment_plan_changed',
      'payment_plan_removed'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. RLS: второй контур защиты Data API
-- ---------------------------------------------------------------------------
-- Предикат повторяет форму spec_item_files / spec_item_comments: членство в
-- организации строки ПЛЮС сверка `org_id` строки с `org_id` родительской
-- позиции. Внешний ключ не гарантирует «одна организация на всю цепочку»,
-- поэтому сверка нужна явно.
--
-- Права: читает любой член организации, включая `viewer` (решение O9 —
-- наблюдатель видит суммы, но не пишет). Пишет любой, кроме `viewer`, — та же
-- граница, что у `can(role, 'record:create')` и у RLS-политики комментариев.
--
-- ВАЖНО: приложение ходит service-role клиентом (lib/supabase/admin.ts),
-- поэтому сегодня эти политики инертны — они страхуют доступ по токену
-- anon/authenticated, а не заменяют проверки в действиях.
alter table public.spec_item_payment_plans enable row level security;

drop policy if exists "spec_item_payment_plans_select_own_org"
  on public.spec_item_payment_plans;
create policy "spec_item_payment_plans_select_own_org"
  on public.spec_item_payment_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_payment_plans.org_id
        and s.org_id = spec_item_payment_plans.org_id
    )
  );

drop policy if exists "spec_item_payment_plans_insert_member"
  on public.spec_item_payment_plans;
create policy "spec_item_payment_plans_insert_member"
  on public.spec_item_payment_plans
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payment_plans.org_id
        and s.org_id = spec_item_payment_plans.org_id
    )
  );

drop policy if exists "spec_item_payment_plans_update_member"
  on public.spec_item_payment_plans;
create policy "spec_item_payment_plans_update_member"
  on public.spec_item_payment_plans
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payment_plans.org_id
        and s.org_id = spec_item_payment_plans.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payment_plans.org_id
        and s.org_id = spec_item_payment_plans.org_id
    )
  );

-- Права DELETE выданы осознанно, хотя приложение удаляет строку графика МЯГКО
-- (`deleted_at`, см. lib/spec/payment-plan-mutations.ts): политика и `grant`
-- описывают границу для прямого доступа к Data API, а не сценарий продукта.
-- Финансовую историю защищает не запрет на удаление строки графика, а `RESTRICT`
-- на её родителях (ADR 0004): ни позицию, ни проект, ни организацию с непустым
-- графиком физически удалить нельзя.
drop policy if exists "spec_item_payment_plans_delete_member"
  on public.spec_item_payment_plans;
create policy "spec_item_payment_plans_delete_member"
  on public.spec_item_payment_plans
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
      where m.user_id = auth.uid()
        and m.role <> 'viewer'
        and m.org_id = spec_item_payment_plans.org_id
        and s.org_id = spec_item_payment_plans.org_id
    )
  );

-- Права: чтение и запись только authenticated (RLS — ворота), anon не получает
-- ничего. Тот же паттерн, что у доступа к объектам Storage.
grant select, insert, update, delete
  on public.spec_item_payment_plans to authenticated;
revoke all on public.spec_item_payment_plans from anon;

-- Представлений над графиком не создавать: `spec_items_priced` принадлежит
-- postgres и обходит RLS базовой таблицы (риск R1 отчёта).

commit;
