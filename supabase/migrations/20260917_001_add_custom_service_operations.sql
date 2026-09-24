-- Свои услуги в дополнительных расходах проекта
--
-- До этого service_operations знала ровно две операции: delivery («Доставка») и
-- installation («Монтаж») — обе с фиксированными подписями и статусными
-- инвариантами (доставка переводит материалы в «Доставлено»; материал нельзя
-- включить в две доставки или два монтажа).
--
-- Теперь нужны произвольные услуги: «Подъём на этаж», «Хранение на складе» и
-- т.п. Модель остаётся ОДНОЙ коллекцией операций проекта, а не второй таблицей:
-- так своя услуга видна и в блоке услуги позиции, и в «Расходах проекта», и в
-- сводке, и в экспорте, а агрегаты считаются в одном месте.
--
--   type = 'service' — своя услуга; name хранит её название;
--   name = null       — у delivery/installation подпись берётся из конфига.
--
-- Связи с позициями у своих услуг необязательны: «Хранение на складе» — расход
-- проекта целиком, а «Подъём на этаж» можно привязать к выбранным позициям.
-- Инварианты доставки и монтажа типом 'service' не затрагиваются: они
-- проверяются только для своих типов.

alter table public.service_operations
  add column if not exists name text;

comment on column public.service_operations.name is
  'Название своей услуги (type = ''service''). У delivery/installation — null: подпись берётся из SERVICE_OPERATION_CONFIG.';

-- Расширяем допустимые типы. Старое ограничение снимаем по имени: оно было
-- объявлено в 20260907_001 как service_operations_type_check.
alter table public.service_operations
  drop constraint if exists service_operations_type_check;

alter table public.service_operations
  add constraint service_operations_type_check
    check (type in ('delivery', 'installation', 'service'));

-- Своя услуга обязана быть названа: без названия строка нечитаема в списках.
alter table public.service_operations
  drop constraint if exists service_operations_name_check;

alter table public.service_operations
  add constraint service_operations_name_check
    check (
      (type = 'service' and name is not null and btrim(name) <> '')
      or (type <> 'service' and name is null)
    );

comment on table public.service_operations is
  'Операции дополнительных расходов проекта: delivery (Доставка), installation (Монтаж) и service (своя услуга с названием в name).';
