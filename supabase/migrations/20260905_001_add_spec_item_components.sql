-- Состав материала (spec_item_components)
--
-- Вспомогательная таблица «состава» верхнеуровневых позиций спецификации:
--   kind = 'group'      — группа состава (например, «Техника»);
--   kind = 'component'  — самостоятельная позиция, не являющаяся строкой
--                         spec_items (например, «Корпус», «Столешница»);
--   kind = 'spec_ref'   — ссылка на существующий SpecItem (например, духовой
--                         шкаф, варочная панель).
-- Строки этой таблицы НЕ являются строками spec_items: они не попадают в
-- основную таблицу, закупку, сводки, PDF и экспорт.
--
-- parent_component_id ссылается на строку-группу в этой же таблице.
-- Ограничение «родитель может быть только kind = ''group''» простым
-- CHECK/FK не выражается (нужна проверка kind родительской строки) и поэтому
-- оставлено для проверки на уровне actions.

create table public.spec_item_components (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  spec_item_id uuid not null,
  parent_component_id uuid,
  kind text not null,
  name text not null,
  ref_spec_item_id uuid,
  company_id uuid,
  contact_id uuid,
  cost numeric,
  notes text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint spec_item_components_org_id_fkey
    foreign key (org_id) references public.organizations (id),
  constraint spec_item_components_spec_item_id_fkey
    foreign key (spec_item_id) references public.spec_items (id)
    on delete cascade,
  constraint spec_item_components_parent_component_id_fkey
    foreign key (parent_component_id) references public.spec_item_components (id)
    on delete cascade,
  constraint spec_item_components_ref_spec_item_id_fkey
    foreign key (ref_spec_item_id) references public.spec_items (id)
    on delete restrict,
  constraint spec_item_components_company_id_fkey
    foreign key (company_id) references public.companies (id),
  constraint spec_item_components_contact_id_fkey
    foreign key (contact_id) references public.contacts (id),

  constraint spec_item_components_kind_check
    check (kind in ('group', 'component', 'spec_ref')),
  constraint spec_item_components_ref_spec_item_id_check
    check (
      (kind in ('group', 'component') and ref_spec_item_id is null)
      or (kind = 'spec_ref' and ref_spec_item_id is not null)
    )
);

create index spec_item_components_spec_item_id_position_idx
  on public.spec_item_components (spec_item_id, position);

create index spec_item_components_parent_component_id_position_idx
  on public.spec_item_components (parent_component_id, position);

create index spec_item_components_ref_spec_item_id_idx
  on public.spec_item_components (ref_spec_item_id)
  where ref_spec_item_id is not null;
