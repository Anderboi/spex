-- Отметка «исполнено» для операций дополнительных расходов.
--
-- Новых таблиц нет: добавляем колонку к существующей service_operations.
-- Отметка используется для доставки: при включении серверная логика
-- (actions/service-operations.ts) автоматически переводит связанные позиции
-- в spec_status = 'delivered'. Никакие ценовые поля spec_items не меняются.

alter table public.service_operations
  add column completed boolean not null default false;

comment on column public.service_operations.completed is
  'Отметка «исполнено» (для доставки). При включении связанные материалы автоматически становятся «Доставлено».';
