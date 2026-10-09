-- ЧЕРНОВИК МИГРАЦИИ. НЕ ВЫПОЛНЯТЬ.
-- Этап 1 — исследование; этот файл приложен к отчёту для обсуждения.
-- Отчёт: .scratch/material-payments/REPORT.md
--
-- Конвенции сняты с фактической схемы (pg_catalog, 2026-10-09), не из типов:
--   id uuid default gen_random_uuid()               (spec_item_files, spec_item_events, service_operations)
--   created_at/updated_at timestamptz default now()
--   деньги numeric(12,2)                            (spec_items.price, materials.price)
--   мягкое удаление deleted_at timestamptz          (spec_items, spec_item_files, spec_item_comments)
--   денормализованные org_id/project_id у детей позиции (spec_item_files, spec_item_events)
--   снимки *_snapshot для читаемости истории        (company_name_snapshot, actor_name_snapshot, supplier_snapshot)
--
-- Отличия от «как у соседей» сделаны сознательно и обоснованы в отчёте:
--   * on delete restrict вместо cascade — финансовая история не удаляется каскадом (решение Q2);
--   * numeric(12,2) у сумм вместо numeric без typmod (как в service_operations.amount);
--   * составной FK «факт → план той же позиции» — защита от несогласованной связи на уровне БД.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Заполнение денормализованных полей и снимков
--    Прецедент: spec_items_sync_org() (BEFORE INSERT/UPDATE, подтягивает org_id из projects).
--    Здесь: org_id/project_id всегда берутся из позиции, поэтому расхождение невозможно
--    даже при конкурентных запросах — проверять в приложении нечего.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Снимки пишутся один раз, при создании записи: последующие правки позиции
  -- не переписывают историю (правило «изменение стоимости не переписывает оплаты»).
  if tg_op = 'INSERT' then
    new.code_snapshot           := v_code;
    new.name_snapshot           := v_name;
    new.project_title_snapshot  := v_title;
    if new.created_by is not null and new.author_name_snapshot is null then
      select u.name into new.author_name_snapshot from public.users u where u.id = new.created_by;
    end if;
  end if;

  return new;
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Плановый платёж (строка графика)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.spec_item_payment_plans (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete restrict,
  project_id   uuid not null references public.projects(id)      on delete restrict,
  spec_item_id uuid not null references public.spec_items(id)    on delete restrict,

  title        text          not null,           -- «название» из ТЗ
  amount       numeric(12,2) not null,           -- сумма плана
  condition    text,                             -- «условие оплаты», свободный текст
  due_date     date,                             -- необязательный срок
  position     integer       not null default 0, -- порядок отображения

  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint spec_item_payment_plans_title_check
    check (char_length(btrim(title)) > 0),
  constraint spec_item_payment_plans_amount_check
    check (amount > 0),
  constraint spec_item_payment_plans_condition_check
    check (condition is null or char_length(btrim(condition)) > 0),

  -- Цель составного FK из фактов: пара (план, позиция) обязана существовать,
  -- поэтому привязать оплату к плану чужой позиции невозможно на уровне БД.
  constraint spec_item_payment_plans_id_item_key unique (id, spec_item_id)
);

-- Два плана не могут делить один номер порядка внутри позиции.
-- Перестановка — одной транзакцией (прецедент обмена кодами: set_spec_item_code).
create unique index spec_item_payment_plans_position_uidx
  on public.spec_item_payment_plans (spec_item_id, position)
  where deleted_at is null;

create index spec_item_payment_plans_item_idx
  on public.spec_item_payment_plans (spec_item_id) where deleted_at is null;
create index spec_item_payment_plans_org_idx     on public.spec_item_payment_plans (org_id);
create index spec_item_payment_plans_project_idx on public.spec_item_payment_plans (project_id);

create trigger spec_item_payment_plans_sync_scope
  before insert or update on public.spec_item_payment_plans
  for each row execute function public.payment_plan_sync_scope();

create trigger set_spec_item_payment_plans_updated_at
  before update on public.spec_item_payment_plans
  for each row execute function public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Фактическая оплата
-- ─────────────────────────────────────────────────────────────────────────────
create table public.spec_item_payments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete restrict,
  project_id      uuid not null references public.projects(id)      on delete restrict,
  spec_item_id    uuid not null references public.spec_items(id)    on delete restrict,
  payment_plan_id uuid,                          -- необязательная связь с планом

  kind            text          not null default 'payment',  -- payment | refund (решение O1)
  amount          numeric(12,2) not null,
  paid_at         date          not null default current_date,
  comment         text,
  -- Реквизиты платежа (номер счёта, поручения, скан) в эту миграцию НЕ входят:
  -- это отдельная задача про документ (решение O10), вместе с публичным показом.

  created_by      uuid references public.users(id) on delete set null,
  author_name_snapshot    text,
  code_snapshot           text,
  name_snapshot           text,
  project_title_snapshot  text,

  -- Ключ идемпотентности от клиента: повторный запрос (двойное нажатие, ретрай)
  -- не создаёт вторую оплату, а возвращает уже созданную запись.
  idempotency_key uuid,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,                   -- мягкое удаление ошибочной проводки

  constraint spec_item_payments_kind_check
    check (kind in ('payment', 'refund')),
  constraint spec_item_payments_amount_check
    check (amount > 0),
  constraint spec_item_payments_comment_check
    check (comment is null or char_length(btrim(comment)) > 0),

  -- Оплата может ссылаться только на план СВОЕЙ позиции.
  -- При payment_plan_id is null ограничение не проверяется (MATCH SIMPLE) —
  -- то есть платежи без плана разрешены, как требует ТЗ.
  constraint spec_item_payments_plan_same_item_fkey
    foreign key (payment_plan_id, spec_item_id)
    references public.spec_item_payment_plans (id, spec_item_id)
    on delete restrict
);

create unique index spec_item_payments_idempotency_uidx
  on public.spec_item_payments (org_id, idempotency_key)
  where idempotency_key is not null;

create index spec_item_payments_item_idx
  on public.spec_item_payments (spec_item_id) where deleted_at is null;
create index spec_item_payments_plan_idx
  on public.spec_item_payments (payment_plan_id) where deleted_at is null;
create index spec_item_payments_project_paid_idx on public.spec_item_payments (project_id, paid_at);
create index spec_item_payments_org_idx          on public.spec_item_payments (org_id);

create trigger spec_item_payments_sync_scope
  before insert or update on public.spec_item_payments
  for each row execute function public.payment_sync_scope();

create trigger set_spec_item_payments_updated_at
  before update on public.spec_item_payments
  for each row execute function public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Аудит: новые виды событий позиции
--    Прецедент расширения списка: 20260919_001, 20260920_001, 20260921_001 —
--    снять CHECK и наложить заново с добавленными значениями.
--    Список синхронизирован с SPEC_ITEM_EVENT_KINDS (lib/spec/history.ts).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.spec_item_events drop constraint spec_item_events_kind_check;
alter table public.spec_item_events add constraint spec_item_events_kind_check
  check (kind = any (array[
    'created', 'filled', 'cleared', 'removed', 'restored', 'code_changed',
    'status_changed', 'price_changed', 'quantity_changed', 'supplier_changed',
    'details_changed', 'parent_changed', 'variant_added', 'variant_switched',
    'variant_updated', 'variant_removed', 'component_added', 'component_removed',
    'service_added', 'service_completed', 'service_removed',
    -- добавлено этим этапом:
    'payment_plan_added', 'payment_plan_changed', 'payment_plan_removed',
    'payment_added', 'payment_changed', 'payment_removed'
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
--    Форма предиката повторяет spec_item_files / spec_item_comments:
--    членство в организации + сверка org_id с родительской позицией.
--    Роли: owner | admin | member | viewer. Писать может любой, кроме viewer
--    (как в комментариях и загрузке файлов); чужую оплату правит admin+.
--    ВАЖНО: приложение ходит service-role клиентом (lib/supabase/admin.ts),
--    поэтому auth.uid() в проде NULL и политики сегодня инертны — они страхуют
--    доступ по anon/authenticated токену, а не заменяют проверки в actions.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.spec_item_payment_plans enable row level security;
alter table public.spec_item_payments      enable row level security;

create policy spec_item_payment_plans_select_own_org
  on public.spec_item_payment_plans for select to authenticated
  using (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
     where m.user_id = auth.uid()
       and m.org_id = spec_item_payment_plans.org_id
       and s.org_id = spec_item_payment_plans.org_id));

create policy spec_item_payment_plans_insert_member
  on public.spec_item_payment_plans for insert to authenticated
  with check (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
     where m.user_id = auth.uid()
       and m.role <> 'viewer'
       and m.org_id = spec_item_payment_plans.org_id
       and s.org_id = spec_item_payment_plans.org_id));

create policy spec_item_payment_plans_update_member
  on public.spec_item_payment_plans for update to authenticated
  using (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
     where m.user_id = auth.uid()
       and m.role <> 'viewer'
       and m.org_id = spec_item_payment_plans.org_id
       and s.org_id = spec_item_payment_plans.org_id))
  with check (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
     where m.user_id = auth.uid()
       and m.role <> 'viewer'
       and m.org_id = spec_item_payment_plans.org_id
       and s.org_id = spec_item_payment_plans.org_id));

create policy spec_item_payment_plans_delete_member
  on public.spec_item_payment_plans for delete to authenticated
  using (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payment_plans.spec_item_id
     where m.user_id = auth.uid()
       and m.role <> 'viewer'
       and m.org_id = spec_item_payment_plans.org_id
       and s.org_id = spec_item_payment_plans.org_id));

-- Факты: чтение — любой член; запись — автор записи или owner/admin.
create policy spec_item_payments_select_own_org
  on public.spec_item_payments for select to authenticated
  using (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
     where m.user_id = auth.uid()
       and m.org_id = spec_item_payments.org_id
       and s.org_id = spec_item_payments.org_id));

create policy spec_item_payments_insert_member
  on public.spec_item_payments for insert to authenticated
  with check (created_by = auth.uid() and exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
     where m.user_id = auth.uid()
       and m.role <> 'viewer'
       and m.org_id = spec_item_payments.org_id
       and s.org_id = spec_item_payments.org_id));

create policy spec_item_payments_update_author_or_manager
  on public.spec_item_payments for update to authenticated
  using ((created_by = auth.uid() or exists (
      select 1 from public.organization_members m
       where m.user_id = auth.uid() and m.org_id = spec_item_payments.org_id
         and m.role in ('owner', 'admin')))
    and exists (
      select 1
        from public.organization_members m
        join public.spec_items s on s.id = spec_item_payments.spec_item_id
       where m.user_id = auth.uid()
         and m.role <> 'viewer'
         and m.org_id = spec_item_payments.org_id
         and s.org_id = spec_item_payments.org_id))
  with check (exists (
    select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_payments.spec_item_id
     where m.user_id = auth.uid()
       and m.role <> 'viewer'
       and m.org_id = spec_item_payments.org_id
       and s.org_id = spec_item_payments.org_id));

create policy spec_item_payments_delete_author_or_manager
  on public.spec_item_payments for delete to authenticated
  using ((created_by = auth.uid() or exists (
      select 1 from public.organization_members m
       where m.user_id = auth.uid() and m.org_id = spec_item_payments.org_id
         and m.role in ('owner', 'admin')))
    and exists (
      select 1
        from public.organization_members m
        join public.spec_items s on s.id = spec_item_payments.spec_item_id
       where m.user_id = auth.uid()
         and m.role <> 'viewer'
         and m.org_id = spec_item_payments.org_id
         and s.org_id = spec_item_payments.org_id));

-- Права: чтение/запись только authenticated (RLS — ворота), anon не получает ничего.
grant select, insert, update, delete on public.spec_item_payment_plans to authenticated;
grant select, insert, update, delete on public.spec_item_payments      to authenticated;
revoke all on public.spec_item_payment_plans from anon;
revoke all on public.spec_item_payments      from anon;

-- Представлений над платежами не создавать: см. риск spec_items_priced в отчёте
-- (view принадлежит postgres и обходит RLS базовой таблицы).

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- ОТКАТ (для черновика; в реальной миграции — обратная миграция)
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--   drop table if exists public.spec_item_payments;
--   drop table if exists public.spec_item_payment_plans;
--   drop function if exists public.payment_sync_scope();
--   drop function if exists public.payment_plan_sync_scope();
--   alter table public.spec_item_events drop constraint spec_item_events_kind_check;
--   alter table public.spec_item_events add constraint spec_item_events_kind_check
--     check (kind = any (array[ ...21 исходное значение... ]));
-- commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- ОТКРЫТЫЕ МЕСТА, КОТОРЫЕ НАДО РЕШИТЬ ДО ВЫПОЛНЕНИЯ
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Перестановка position: двумя UPDATE в одной транзакции, иначе частичный
--    unique-индекс упадёт. Прецедент — set_spec_item_code (обмен кодами одним
--    statement-ом, с блокировкой проекта через `for update`).
-- 2. Идемпотентность: action обязан при конфликте по
--    spec_item_payments_idempotency_uidx (SQLSTATE 23505) вернуть существующую
--    запись, а не ошибку; при повторном запросе с другим телом — ошибку.
-- 3. Проверка «план без фактов» перед soft-delete плана (решение Q9) — уровень
--    action, потому что мягкое удаление не нарушает FK.
-- 4. Возврат (kind = 'refund') уменьшает оплаченное: paid_net = Σ payment − Σ refund.
--    Возврат больше, чем оплачено, БД не запрещает — интерфейс показывает это явной
--    пометкой (решение Q11: показывать, причину не требовать).
-- 5. Публичный показ платежей — опциональный (решение O4). Переключатель и состав
--    публичного блока определяются отдельным решением; схема этой миграции их не
--    требует, но и не мешает: см. research/05-public-channel.md.
-- 6. Реквизиты платежа и вложения (счёт, поручение, чек, договор) — отдельная задача
--    про документ (решение O10); в этой миграции колонок под них нет намеренно.
