-- Поставщики материала библиотеки (material_suppliers)
--
-- Один и тот же материал продаётся в нескольких компаниях, и цена у каждой
-- своя. Строка этой таблицы — «этот материал бывает у этой компании»: компания,
-- её менеджер, цена и ссылка на страницу товара. Цена по ссылке автоматически
-- не обновляется (см. `.scratch/material-suppliers/spec.md`, раздел «Отложено»).
--
-- Позиция спецификации по-прежнему берёт одного поставщика: основным считается
-- первая строка (`position` = 0), и её значения зеркалятся в
-- `materials.company_id`, `contact_id`, `price`, `product_url`. Зеркало — кэш для
-- чтения: по нему работает список библиотеки, добавление материала в проект и
-- карточка компании, поэтому позиции, сводки и экспорт не меняются.
--
-- `materials.supplier_company_ids` — денормализация того же зеркала: массив
-- компаний, у которых материал есть. Нужен фильтру библиотеки «по компании»
-- (`?company=<id>`): PostgREST не умеет фильтровать родительские строки по
-- вложенной таблице без `!inner`, а `!inner` выбросил бы материалы без
-- поставщика вовсе. Массив заполняет приложение (`lib/materials/suppliers.ts`).

-- Каждый шаг идемпотентен (`if not exists`, `on conflict do nothing`): у этого
-- проекта нет учёта применённых миграций — `supabase_migrations.schema_migrations`
-- в живой базе отсутствует вовсе, поэтому `supabase db push` здесь не работает
-- (он попытался бы прогнать все файлы подряд), а SQL применяют руками. Файл,
-- который нельзя запустить дважды, в таком режиме опасен.

create table if not exists public.material_suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  material_id uuid not null,
  company_id uuid,
  contact_id uuid,
  price numeric not null default 0,
  product_url text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint material_suppliers_org_id_fkey
    foreign key (org_id) references public.organizations (id),
  constraint material_suppliers_material_id_fkey
    foreign key (material_id) references public.materials (id)
    on delete cascade,
  -- Компанию удаляют из справочника — материал остаётся, но без этого
  -- поставщика: строка теряет компанию, цена и ссылка сохраняются.
  constraint material_suppliers_company_id_fkey
    foreign key (company_id) references public.companies (id)
    on delete set null,
  constraint material_suppliers_contact_id_fkey
    foreign key (contact_id) references public.contacts (id)
    on delete set null
);

create index if not exists material_suppliers_material_id_position_idx
  on public.material_suppliers (material_id, position);

-- Одна компания — одна строка на материал. Частичный индекс: строки без
-- компании (поставщик удалён из справочника) уникальности не подчиняются.
create unique index if not exists material_suppliers_material_id_company_id_key
  on public.material_suppliers (material_id, company_id)
  where company_id is not null;

-- Денормализация для фильтра библиотеки по компании. GIN — под `contains`
-- (`supplier_company_ids @> array['…']`).
alter table public.materials
  add column if not exists supplier_company_ids uuid[] not null default '{}';

create index if not exists materials_supplier_company_ids_idx
  on public.materials using gin (supplier_company_ids);

-- Переносим существующего поставщика материала в новую таблицу: до этой
-- миграции он был один, и он же становится основным. `on conflict do nothing` —
-- на случай повторного запуска: набор строк уже перенесён.
insert into public.material_suppliers
  (org_id, material_id, company_id, contact_id, price, product_url, position)
select
  m.org_id,
  m.id,
  m.company_id,
  m.contact_id,
  coalesce(m.price, 0),
  m.product_url,
  0
from public.materials m
where m.company_id is not null
on conflict (material_id, company_id) where company_id is not null do nothing;

update public.materials m
set supplier_company_ids = array[m.company_id]
where m.company_id is not null;
