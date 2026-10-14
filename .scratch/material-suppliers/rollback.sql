-- Обратная миграция фичи «несколько поставщиков материала библиотеки».
--
-- Возвращает схему ровно в то состояние, в каком она была до 20261013_001…003:
-- удаляет таблицу `material_suppliers`, колонку `materials.supplier_company_ids`
-- (вместе с её GIN-индексом) и функцию `sync_material_suppliers`. Больше ничего
-- та миграция не создавала и не меняла, RLS-политики уходят вместе с таблицей.
--
-- ПОРЯДОК ВАЖЕН: сначала откатывается приложение, потом выполняется этот файл.
-- Новый код без этих объектов не работает — список библиотеки выбирает
-- `material_suppliers`, сохранение материала зовёт `sync_material_suppliers`.
-- Прежний код работает и с ними, и без них, поэтому откат приложения можно
-- сделать первым шагом и не спешить с удалением.
--
-- ЧТО ТЕРЯЕТСЯ безвозвратно: строки дополнительных поставщиков (их цены и
-- ссылки). Компания, менеджер, цена и ссылка ОСНОВНОГО поставщика остаются в
-- колонках `materials` — они там и были. Если дополнительных поставщиков уже
-- завели и они нужны, выгрузите их до удаления:
--
--   copy (select * from public.material_suppliers)
--     to stdout with (format csv, header true);
--
-- Файл идемпотентен: `if exists` позволяет запускать его повторно.
--
--   -- Без явной транзакции: Dashboard SQL Editor выполняет скрипт целиком,
--   -- но с ней «всё или ничего» гарантировано в любом клиенте.

begin;

drop function if exists public.sync_material_suppliers(uuid, uuid, jsonb);

-- Политики RLS и индексы таблицы уходят вместе с ней.
drop table if exists public.material_suppliers;

-- Зависимый GIN-индекс `materials_supplier_company_ids_idx` удаляется вместе с
-- колонкой, отдельный `drop index` не нужен.
alter table public.materials drop column if exists supplier_company_ids;

commit;

-- ПРОВЕРКА после отката (обе выборки должны быть пустыми):
--   select count(*) from pg_class where relname in
--     ('material_suppliers', 'materials_supplier_company_ids_idx');
--   select count(*) from information_schema.columns
--    where table_name = 'materials' and column_name = 'supplier_company_ids';
--   select count(*) from pg_proc where proname = 'sync_material_suppliers';
--
-- ЕДИНСТВЕННОЕ, что откат не возвращает: `updated_at` у 14 материалов, которых
-- коснулся перенос данных (на `materials` висят триггеры `touch_updated_at` и
-- `handle_updated_at`). В интерфейсе библиотеки этот timestamp не показывается и
-- в сортировках не участвует, так что незаметно.
