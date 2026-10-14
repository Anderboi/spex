-- Синхронизация поставщиков материала и зеркала в колонках `materials`
--
-- Список поставщиков и его зеркало (`materials.company_id`, `contact_id`, `price`,
-- `product_url`, `supplier_company_ids`) обязаны совпадать: по зеркалу работает
-- список библиотеки, фильтр «по компании», добавление материала в проект и
-- карточка компании. Пять запросов из приложения эту связку не удержат — сбой на
-- любом шаге оставил бы материал с поставщиком в одной таблице и без него в
-- другой, — поэтому и удаление, и вставка, и пересчёт зеркала живут в одной
-- транзакционной функции (прецедент — `move_spec_item_payment_plan`).
--
-- `p_suppliers` — ПОЛНЫЙ набор строк материала, а не патч: `null` значит «набор не
-- менялся, пересобери только зеркало» (так функция вызывается, когда компанию
-- удаляют из справочника: строки теряют компанию по `on delete set null`).
-- Строка без компании поставщиком не является и удаляется — цена при этом не
-- теряется: зеркало не переписывает `price`, пока поставщиков не осталось.
--
-- Имена аргументов намеренно не совпадают с именами колонок (`p_material_id`, а не
-- `material_id`): условие `material_id = p_material_id` разбиралось бы как
-- сравнение колонки с собой (см. предупреждение в 20261009_001).
create or replace function public.sync_material_suppliers(
  p_org_id      uuid,
  p_material_id uuid,
  p_suppliers   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_primary     jsonb;
  v_company_ids uuid[];
begin
  -- Прямой вызов через Data API от имени вошедшего пользователя: чужую
  -- организацию трогать нельзя. Приложение ходит с service role, где auth.uid()
  -- пуст (приложение авторизует через next-auth, см. 20260927_001), поэтому
  -- проверка срабатывает ровно тогда, когда uid есть, — как в
  -- `update_organization_name`.
  if auth.uid() is not null
     and not exists (
       select 1
         from public.organization_members m
        where m.user_id = auth.uid()
          and m.org_id = p_org_id
     )
  then
    raise exception 'FORBIDDEN: %', p_org_id;
  end if;

  if not exists (
    select 1
      from public.materials
     where id = p_material_id
       and org_id = p_org_id
  ) then
    raise exception 'MATERIAL_NOT_FOUND: %', p_material_id;
  end if;

  -- `jsonb_typeof(...) = 'array'`, а не просто `is not null`: JSON-`null` в
  -- аргументе может доехать как скаляр `null`, и `jsonb_array_elements` на нём
  -- упал бы с «cannot extract elements from a scalar». Проверка типа принимает
  -- оба прочтения «набор не менялся» — и SQL NULL, и скаляр.
  if jsonb_typeof(p_suppliers) = 'array' then
    -- Удаляем то, чего нет в новом наборе: форма присылает список целиком.
    delete from public.material_suppliers ms
     where ms.material_id = p_material_id
       and ms.org_id = p_org_id
       and not exists (
         select 1
           from jsonb_array_elements(p_suppliers) e
          where nullif(e->>'id', '') is not null
            and (e->>'id')::uuid = ms.id
       );

    insert into public.material_suppliers as ms (
      id, org_id, material_id, company_id, contact_id,
      price, product_url, position, updated_at
    )
    select
      coalesce(nullif(e->>'id', '')::uuid, gen_random_uuid()),
      p_org_id,
      p_material_id,
      nullif(e->>'company_id', '')::uuid,
      nullif(e->>'contact_id', '')::uuid,
      coalesce((e->>'price')::numeric, 0),
      nullif(e->>'product_url', ''),
      coalesce((e->>'position')::integer, 0),
      now()
      from jsonb_array_elements(p_suppliers) e
    on conflict (id) do update
       set company_id  = excluded.company_id,
           contact_id  = excluded.contact_id,
           price       = excluded.price,
           product_url = excluded.product_url,
           position    = excluded.position,
           updated_at  = now()
     where ms.material_id = p_material_id;
  end if;

  -- Компанию удалили из справочника — строка осталась без компании. Поставщика в
  -- ней больше нет: её место не в списке, а в истории материала.
  delete from public.material_suppliers
   where material_id = p_material_id
     and org_id = p_org_id
     and company_id is null;

  select array_agg(company_id order by position, created_at, id)
    into v_company_ids
    from public.material_suppliers
   where material_id = p_material_id
     and company_id is not null;

  v_company_ids := coalesce(v_company_ids, '{}');

  select to_jsonb(t)
    into v_primary
    from (
      select company_id, contact_id, price, product_url
        from public.material_suppliers
       where material_id = p_material_id
       order by position, created_at, id
       limit 1
    ) t;

  -- Зеркало. Цену и ссылку переписываем только когда поставщик есть: у материала
  -- без поставщиков цена своя, и снятие последнего её не трогает.
  update public.materials m
     set company_id           = (v_primary->>'company_id')::uuid,
         contact_id           = nullif(v_primary->>'contact_id', '')::uuid,
         supplier_company_ids = v_company_ids,
         price                = case
                                  when v_primary is null then m.price
                                  else coalesce((v_primary->>'price')::numeric, 0)
                                end,
         product_url          = case
                                  when v_primary is null then m.product_url
                                  else nullif(v_primary->>'product_url', '')
                                end,
         updated_at           = now()
   where m.id = p_material_id
     and m.org_id = p_org_id;
end
$function$;

comment on function public.sync_material_suppliers(uuid, uuid, jsonb) is
  'Полная замена списка поставщиков материала и пересборка зеркала в materials (company_id, contact_id, price, product_url, supplier_company_ids). p_suppliers = null — набор не менялся, пересобрать только зеркало.';

revoke all on function public.sync_material_suppliers(uuid, uuid, jsonb) from public;
revoke all on function public.sync_material_suppliers(uuid, uuid, jsonb) from anon;
grant execute on function public.sync_material_suppliers(uuid, uuid, jsonb) to authenticated;
grant execute on function public.sync_material_suppliers(uuid, uuid, jsonb) to service_role;
