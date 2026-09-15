-- Второй уровень структуры материалов: ТИП + характеристики в библиотеке.
--
-- До этой миграции:
--   * `materials.category` и `spec_items.type` — один и тот же словарь
--     (Отделка, Мебель, Сантехника…). Это КАТЕГОРИЯ.
--   * «тип» (керамогранит, ламинат, обои) существовал только как свободный
--     текст в `product_type` и в форму ручного добавления не попадал вообще;
--   * характеристики (`attrs`) жили только в позиции спецификации —
--     у материала библиотеки такой колонки не было, поэтому библиотека не
--     могла работать шаблоном.
--
-- Здесь:
--   1. в `materials` добавляется `attrs` — шаблон характеристик материала;
--   2. RPC `create_manual_spec_item` учится писать тип, ссылку, срок поставки и
--      характеристики в позицию И в библиотеку. Заодно исправляется потеря
--      изображения: форма его загружала, а RPC в `materials` не сохранял.

-- ── 1. характеристики материала в библиотеке ────────────────────────────────
alter table public.materials
  add column if not exists attrs jsonb not null default '{}'::jsonb;

comment on column public.materials.attrs is
  'Характеристики материала (ключ → значение), шаблон для новых позиций спецификации';
comment on column public.materials.category is
  'Категория — раздел спецификации (Отделка, Мебель, …), словарь spec_types';
comment on column public.materials.product_type is
  'Тип материала внутри категории: керамогранит, ламинат, обои, …';

-- ── 2. RPC: тип, ссылка, срок поставки и характеристики ─────────────────────
-- Параметры добавляются В КОНЕЦ сигнатуры, поэтому прежнюю версию нужно
-- удалить явно: `create or replace` с другим списком аргументов создал бы
-- перегрузку, и вызов с прежним набором имён стал бы неоднозначным.
--
-- В базе накопились ТРИ версии этой функции (видно по сгенерированным типам
-- `Functions.create_manual_spec_item` — там union из трёх сигнатур): прошлые
-- миграции тоже не удаляли предыдущую версию. Чистим все: иначе следующая
-- правка аргументов снова упрётся в неоднозначность. Если какая-то из старых
-- сигнатур не совпадёт, `if exists` просто ничего не сделает.
drop function if exists public.create_manual_spec_item(
  uuid, uuid, uuid, uuid, uuid, text, uuid,
  text, text, text, text, text, text, numeric, text,
  numeric, numeric, numeric, numeric, boolean
);
drop function if exists public.create_manual_spec_item(
  uuid, uuid, uuid, uuid, uuid, text, uuid,
  text, text, text, text, text, text, text, numeric, text,
  numeric, numeric, numeric, numeric, boolean
);
drop function if exists public.create_manual_spec_item(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text,
  text, numeric, text, numeric, numeric, numeric, numeric, boolean, uuid
);

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
  p_parent_id uuid default null,
  p_product_type text default null,
  p_product_url text default null,
  p_lead_time text default null,
  p_attrs jsonb default '{}'::jsonb
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.spec_status;
  v_attrs jsonb := coalesce(p_attrs, '{}'::jsonb);
  v_lead_time text := nullif(p_lead_time, '');
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

  -- 1. библиотека материалов (только если попросили).
  --    p_type — это КАТЕГОРИЯ позиции, она же `materials.category`.
  if p_save_to_library then
    insert into public.materials (
      id, org_id, created_by, name, brand, category, article, unit, price,
      company_id, image_url, product_type, product_url, lead_time, attrs
    ) values (
      p_material_id, p_org_id, p_created_by, p_name, p_brand, p_type,
      p_article, p_unit, p_price, p_company_id,
      p_image_url, nullif(p_product_type, ''), nullif(p_product_url, ''),
      v_lead_time, v_attrs
    );
  end if;

  -- 2. позиция спецификации
  insert into public.spec_items (
    id, project_id, org_id, material_id, company_id, company_name_snapshot,
    image_url, parent_id, code, type, name, brand, spec, article,
    qty, unit, price, stock_pct, client_discount_pct, supplier_discount_pct,
    status, is_placeholder, position, product_type, product_url, lead_time, attrs
  ) values (
    p_item_id, p_project_id, p_org_id, p_material_id, p_company_id, p_company_name,
    p_image_url, p_parent_id, p_code, p_type, p_name, p_brand, p_spec, p_article,
    p_qty, p_unit, p_price, p_stock_pct, p_client_discount_pct, p_supplier_discount_pct,
    v_status, false,
    (select coalesce(max(position), -1) + 1
     from public.spec_items
     where project_id = p_project_id and deleted_at is null),
    nullif(p_product_type, ''), nullif(p_product_url, ''), v_lead_time, v_attrs
  );

  return query select p_item_id as id;

exception
  when unique_violation then
    -- любой дубль (марка уже занята) — откат обеих вставок и понятная ошибка
    raise exception 'CODE_TAKEN';
end;
$$;

-- DROP снимает все выданные на функцию права, поэтому выдаём их заново явно.
-- Приложение вызывает RPC служебным ключом (lib/db/guard.ts → scoped()
-- возвращает createAdminClient()), то есть от имени service_role.
grant execute on function public.create_manual_spec_item(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text,
  text, numeric, text, numeric, numeric, numeric, numeric, boolean, uuid,
  text, text, text, jsonb
) to service_role, authenticated;
