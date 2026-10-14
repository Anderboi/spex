-- RLS для material_suppliers (поставщики материала библиотеки)
--
-- Паттерн тот же, что у spec_item_components: доступ к строкам есть только у
-- участников организации, которой принадлежит материал. Дополнительно org_id
-- строки сверяется с org_id материала: внешний ключ не гарантирует «одна
-- организация на всю цепочку».
--
-- Приложение работает через server actions (service role), для которых RLS не
-- является преградой; политики защищают прямое обращение к данным через Data API
-- от имени пользователя (authenticated).

alter table public.material_suppliers enable row level security;

drop policy if exists "material_suppliers_select_own_org" on public.material_suppliers;
create policy "material_suppliers_select_own_org"
  on public.material_suppliers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.materials mat on mat.id = material_suppliers.material_id
      where m.user_id = auth.uid()
        and m.org_id = material_suppliers.org_id
        and mat.org_id = material_suppliers.org_id
    )
  );

drop policy if exists "material_suppliers_insert_own_org" on public.material_suppliers;
create policy "material_suppliers_insert_own_org"
  on public.material_suppliers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.materials mat on mat.id = material_suppliers.material_id
      where m.user_id = auth.uid()
        and m.org_id = material_suppliers.org_id
        and mat.org_id = material_suppliers.org_id
    )
  );

drop policy if exists "material_suppliers_update_own_org" on public.material_suppliers;
create policy "material_suppliers_update_own_org"
  on public.material_suppliers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.materials mat on mat.id = material_suppliers.material_id
      where m.user_id = auth.uid()
        and m.org_id = material_suppliers.org_id
        and mat.org_id = material_suppliers.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      join public.materials mat on mat.id = material_suppliers.material_id
      where m.user_id = auth.uid()
        and m.org_id = material_suppliers.org_id
        and mat.org_id = material_suppliers.org_id
    )
  );

drop policy if exists "material_suppliers_delete_own_org" on public.material_suppliers;
create policy "material_suppliers_delete_own_org"
  on public.material_suppliers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.materials mat on mat.id = material_suppliers.material_id
      where m.user_id = auth.uid()
        and m.org_id = material_suppliers.org_id
        and mat.org_id = material_suppliers.org_id
    )
  );
