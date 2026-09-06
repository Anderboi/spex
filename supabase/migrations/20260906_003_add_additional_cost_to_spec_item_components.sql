-- Ссылки на существующие SpecItem в составе: дополнительная сумма.
--
-- spec_item_components.additional_cost — «ручная» дополнительная сумма строки
-- состава kind = 'spec_ref' (например, доплата за монтаж встраиваемой техники).
-- Для kind = 'group' и kind = 'component' поле не используется и остаётся null.
--
-- Существующие поля, связи, ограничения и основная таблица spec_items не меняются.

alter table public.spec_item_components
  add column additional_cost numeric;

comment on column public.spec_item_components.additional_cost is
  'Дополнительная сумма для kind = ''spec_ref'' (ручная). Для component/group не используется.';

alter table public.spec_item_components
  add constraint spec_item_components_additional_cost_check
    check (additional_cost is null or additional_cost >= 0);
