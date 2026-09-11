-- Дополнительные расходы проекта: операции «Монтаж» и «Доставка»
--
-- Одна операция может быть связана с несколькими SpecItem (service_operations),
-- одна позиция может участвовать в нескольких операциях
-- (service_operation_items — связующая таблица).
--
-- Стоимость операции (service_operations.amount) — самостоятельный агрегат:
-- она НЕ пишется в spec_items.cost и не суммируется повторно на каждую
-- связанную позицию. В отображении операции показываются отдельным блоком.
--
-- Организация всегда берётся из сессии (server actions); org_id колонки —
-- для RLS и проверки принадлежности, из клиента он не принимается.

create table public.service_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null,
  type text not null,
  amount numeric not null,
  deadline date,
  contractor_company_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint service_operations_org_id_fkey
    foreign key (org_id) references public.organizations (id),
  constraint service_operations_project_id_fkey
    foreign key (project_id) references public.projects (id)
    on delete cascade,
  constraint service_operations_contractor_company_id_fkey
    foreign key (contractor_company_id) references public.companies (id)
    on delete set null,

  constraint service_operations_type_check
    check (type in ('delivery', 'installation')),
  constraint service_operations_amount_check
    check (amount >= 0)
);

comment on table public.service_operations is
  'Операции дополнительных расходов проекта: delivery (Доставка) и installation (Монтаж).';
comment on column public.service_operations.contractor_company_id is
  'Подрядчик операции (компания организации). Необязательный.';

create index service_operations_org_id_idx
  on public.service_operations (org_id);

create index service_operations_project_id_idx
  on public.service_operations (project_id);

-- Связка операция ⇄ позиция спецификации (многие ко многим).
create table public.service_operation_items (
  operation_id uuid not null,
  spec_item_id uuid not null,

  constraint service_operation_items_pkey
    primary key (operation_id, spec_item_id),
  constraint service_operation_items_operation_id_fkey
    foreign key (operation_id) references public.service_operations (id)
    on delete cascade,
  constraint service_operation_items_spec_item_id_fkey
    foreign key (spec_item_id) references public.spec_items (id)
    on delete cascade
);

comment on table public.service_operation_items is
  'Связанные позиции спецификации операции дополнительных расходов.';

-- Индекс для поиска операций по позиции (обратное направление к PK).
create index service_operation_items_spec_item_id_idx
  on public.service_operation_items (spec_item_id);

/* ------------------------------------------------------------------ */
/*  RLS                                                               */
/* ------------------------------------------------------------------ */
-- Паттерн минимальный, как в spec_item_components: читать/менять операции
-- могут только участники организации, которой принадлежит строка.
-- Приложение работает через server actions (service role), для которых RLS
-- не является преградой; политики защищают прямое обращение к данным через
-- Data API от имени пользователя (authenticated).

alter table public.service_operations enable row level security;

drop policy if exists "service_operations_select_own_org" on public.service_operations;
create policy "service_operations_select_own_org"
  on public.service_operations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = service_operations.org_id
    )
  );

drop policy if exists "service_operations_insert_own_org" on public.service_operations;
create policy "service_operations_insert_own_org"
  on public.service_operations
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.projects p on p.id = service_operations.project_id
      where m.user_id = auth.uid()
        and m.org_id = service_operations.org_id
        and p.org_id = service_operations.org_id
    )
  );

drop policy if exists "service_operations_update_own_org" on public.service_operations;
create policy "service_operations_update_own_org"
  on public.service_operations
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = service_operations.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.projects p on p.id = service_operations.project_id
      where m.user_id = auth.uid()
        and m.org_id = service_operations.org_id
        and p.org_id = service_operations.org_id
    )
  );

drop policy if exists "service_operations_delete_own_org" on public.service_operations;
create policy "service_operations_delete_own_org"
  on public.service_operations
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = service_operations.org_id
    )
  );

alter table public.service_operation_items enable row level security;

-- Связка не хранит org_id (по ТЗ); принадлежность определяется через
-- операцию, а при вставке дополнительно сверяется организация позиции.
drop policy if exists "service_operation_items_select_own_org" on public.service_operation_items;
create policy "service_operation_items_select_own_org"
  on public.service_operation_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.service_operations so on so.id = service_operation_items.operation_id
      where m.user_id = auth.uid()
        and m.org_id = so.org_id
    )
  );

drop policy if exists "service_operation_items_insert_own_org" on public.service_operation_items;
create policy "service_operation_items_insert_own_org"
  on public.service_operation_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.service_operations so on so.id = service_operation_items.operation_id
      join public.spec_items si on si.id = service_operation_items.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = so.org_id
        and si.org_id = so.org_id
        and si.project_id = so.project_id
    )
  );

drop policy if exists "service_operation_items_update_own_org" on public.service_operation_items;
create policy "service_operation_items_update_own_org"
  on public.service_operation_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.service_operations so on so.id = service_operation_items.operation_id
      where m.user_id = auth.uid()
        and m.org_id = so.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.service_operations so on so.id = service_operation_items.operation_id
      join public.spec_items si on si.id = service_operation_items.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = so.org_id
        and si.org_id = so.org_id
        and si.project_id = so.project_id
    )
  );

drop policy if exists "service_operation_items_delete_own_org" on public.service_operation_items;
create policy "service_operation_items_delete_own_org"
  on public.service_operation_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.service_operations so on so.id = service_operation_items.operation_id
      where m.user_id = auth.uid()
        and m.org_id = so.org_id
    )
  );
