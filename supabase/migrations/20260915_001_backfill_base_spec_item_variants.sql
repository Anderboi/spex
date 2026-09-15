-- Базовый материал позиции всегда хранится вариантом (position = 0, label «Основной»).
--
-- До этого варианты заводились только как «замены» (position >= 1), а исходный
-- материал позиции жил лишь в плоских полях spec_items. Когда активным становился
-- вариант-замена, applyActiveVariant перекрывал эти поля, и вернуться к исходному
-- материалу из интерфейса было нечем.
--
-- Миграция идемпотентна: снимок создаётся только там, где варианта с position = 0
-- ещё нет. Снимок помечается активным, только если активного варианта у позиции
-- нет (на позиции не должно быть двух активных — на это есть уникальный индекс).
--
-- Предположение: плоские поля spec_items на момент миграции содержат исходный
-- материал позиции. Для позиций, где вариант position = 0 уже есть, ничего не
-- меняется.

insert into public.spec_item_variants (
  spec_item_id,
  org_id,
  name,
  brand,
  article,
  spec,
  price,
  product_url,
  image_url,
  lead_time,
  company_id,
  contact_id,
  company_name_snapshot,
  label,
  is_active,
  position
)
select
  i.id,
  i.org_id,
  coalesce(i.name, ''),
  coalesce(i.brand, ''),
  coalesce(i.article, ''),
  coalesce(i.spec, ''),
  coalesce(i.price, 0),
  coalesce(i.product_url, ''),
  i.image_url,
  coalesce(i.lead_time, ''),
  i.company_id,
  i.contact_id,
  coalesce(i.company_name_snapshot, ''),
  'Основной',
  not exists (
    select 1
    from public.spec_item_variants v
    where v.spec_item_id = i.id
      and v.is_active
  ),
  0
from public.spec_items i
where i.deleted_at is null
  and i.is_placeholder = false
  and coalesce(i.name, '') <> ''
  and not exists (
    select 1
    from public.spec_item_variants v
    where v.spec_item_id = i.id
      and v.position = 0
  );
