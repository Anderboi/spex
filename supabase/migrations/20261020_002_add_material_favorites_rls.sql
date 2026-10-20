-- RLS для material_favorites (избранное в библиотеке материалов)
--
-- Отметка личная, поэтому политика строже, чем у соседних таблиц: доступны
-- только СВОИ строки и только в организации, где пользователь состоит. Коллега
-- не видит чужих отметок и не может изменить чужую.
--
-- Приложение ходит сервисной ролью (так устроен весь проект), для неё RLS не
-- преграда — политика второй слой, а не единственная защита: каждый запрос к
-- отметкам фильтруется по текущему пользователю явно
-- (`lib/materials/favorites.ts`, `lib/queries.ts`).
--
-- `anon` не получает ни одной политики: таблица для него закрыта целиком.
--
-- В отличие от `material_suppliers`, политика не поднимается по связи к
-- материалу: организация хранится в самой строке именно для того, чтобы проверка
-- членства не делала лишний join (spec.md, «Хранение»). Согласованность
-- `material_id` и `org_id` обеспечивает слой записи — модуль избранного сверяет
-- материал с организацией до вставки, а служба ходит сервисной ролью.

alter table public.material_favorites enable row level security;

drop policy if exists "material_favorites_select_own" on public.material_favorites;
create policy "material_favorites_select_own"
  on public.material_favorites
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = material_favorites.org_id
    )
  );

drop policy if exists "material_favorites_insert_own" on public.material_favorites;
create policy "material_favorites_insert_own"
  on public.material_favorites
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = material_favorites.org_id
    )
  );

-- Строка по смыслу неизменяема (отметить или снять — это вставка и удаление),
-- но политика обновления оставлена для симметрии с соседними таблицами и не
-- расширяет доступ: менять можно только свою строку в своей организации.
drop policy if exists "material_favorites_update_own" on public.material_favorites;
create policy "material_favorites_update_own"
  on public.material_favorites
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = material_favorites.org_id
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = material_favorites.org_id
    )
  );

drop policy if exists "material_favorites_delete_own" on public.material_favorites;
create policy "material_favorites_delete_own"
  on public.material_favorites
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = material_favorites.org_id
    )
  );

-- Права: чтение и запись только authenticated (RLS — ворота), anon не получает
-- ничего. Тот же паттерн, что у оплат и графика платежей.
grant select, insert, update, delete
  on public.material_favorites to authenticated;
revoke all on public.material_favorites from anon;
