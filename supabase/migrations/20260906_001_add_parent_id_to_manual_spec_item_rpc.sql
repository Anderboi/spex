-- Ручное создание позиции спецификации: теперь поддерживает parent_id
-- (дочерний SpecItem → SpecItem), чтобы связь писалась тем же INSERT,
-- а не «догонялась» вторым патчем из клиента.
--
-- p_parent_id — необязательный (default null): обычное создание без родителя
-- работает как раньше. Сигнатура повторяет уже применённую на проде версию
-- с p_image_url и добавляет p_parent_id последним параметром.
create or replace function public.create_manual_spec_item(
  p_org_id uuid,
  p_project_id uuid,
  p_item_id uuid,
  p_material_id uuid,
  p_company_id uuid,
  p_company_name text,
  p_created_by uuid,
  p_image_url text,
  p_code text,
  p_type text,
  p_name text,
  p_brand text,
  p_spec text,
  p_article text,
  p_qty numeric,
  p_unit text,
  p_price numeric,
  p_stock_pct numeric,
  p_client_discount_pct numeric,
  p_supplier_discount_pct numeric,
  p_save_to_library boolean,
  p_parent_id uuid default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.spec_status;
begin
  -- защита: проект принадлежит организации и не удалён
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.org_id = p_org_id and p.deleted_at is null
  ) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  v_status := case
    when p_price > 0 then 'picked'::public.spec_status
    else 'draft'::public.spec_status
  end;

  -- 1. библиотека материалов (только если попросили)
  if p_save_to_library then
    insert into public.materials (
      id, org_id, created_by, name, brand, category, article, unit, price, company_id
    ) values (
      p_material_id, p_org_id, p_created_by, p_name, p_brand, p_type,
      p_article, p_unit, p_price, p_company_id
    );
  end if;

  -- 2. позиция спецификации
  insert into public.spec_items (
    id, project_id, org_id, material_id, company_id, company_name_snapshot,
    image_url, parent_id, code, type, name, brand, spec, article,
    qty, unit, price, stock_pct, client_discount_pct, supplier_discount_pct,
    status, is_placeholder, position
  ) values (
    p_item_id, p_project_id, p_org_id, p_material_id, p_company_id, p_company_name,
    p_image_url, p_parent_id, p_code, p_type, p_name, p_brand, p_spec, p_article,
    p_qty, p_unit, p_price, p_stock_pct, p_client_discount_pct, p_supplier_discount_pct,
    v_status, false,
    (select coalesce(max(position), -1) + 1
     from public.spec_items
     where project_id = p_project_id and deleted_at is null)
  );

  return query select p_item_id as id;

exception
  when unique_violation then
    -- любой дубль (марка уже занята) — откат обеих вставок и понятная ошибка
    raise exception 'CODE_TAKEN';
end;
$$;
