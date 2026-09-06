-- RLS для spec_item_components (состав позиции спецификации)
--
-- Паттерн минимальный: доступ к строкам состава есть только у участников
-- организации, которой принадлежит компонент (organization_members).
-- Дополнительно org_id строки сверяется с org_id родительского spec_item:
-- внешний ключ не гарантирует «одна организация на всю цепочку», поэтому
-- принадлежность к позиции проверяется явно.
--
-- Приложение работает через server actions (service role), для которых RLS
-- не является преградой; политики защищают прямое обращение к данным через
-- Data API от имени пользователя (authenticated).

alter table public.spec_item_components enable row level security;

drop policy if exists "spec_item_components_select_own_org" on public.spec_item_components;
create policy "spec_item_components_select_own_org"
  on public.spec_item_components
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_components.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_components.org_id
        and s.org_id = spec_item_components.org_id
    )
  );

drop policy if exists "spec_item_components_insert_own_org" on public.spec_item_components;
create policy "spec_item_components_insert_own_org"
  on public.spec_item_components
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_components.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_components.org_id
        and s.org_id = spec_item_components.org_id
    )
  );

drop policy if exists "spec_item_components_update_own_org" on public.spec_item_components;
create policy "spec_item_components_update_own_org"
  on public.spec_item_components
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_components.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_components.org_id
        and s.org_id = spec_item_components.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_components.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_components.org_id
        and s.org_id = spec_item_components.org_id
    )
  );

drop policy if exists "spec_item_components_delete_own_org" on public.spec_item_components;
create policy "spec_item_components_delete_own_org"
  on public.spec_item_components
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_components.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_components.org_id
        and s.org_id = spec_item_components.org_id
    )
  );
