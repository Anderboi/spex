-- ============================================================================
-- Документы к оплате позиции: public.spec_item_files.payment_id
-- ============================================================================
--
-- Тикет `.scratch/material-payments/issues/06-vid-zapisi-i-dokumenty.md`.
-- К оплате (факту `spec_item_payments`) можно прикрепить документ: чек,
-- платёжное поручение, счёт. Файл остаётся ОБЫЧНЫМ файлом позиции
-- (`spec_item_files`) — новая таблица не заводится, потому что всё, что нужно
-- документу (метаданные, приватный bucket, права, мягкое удаление), у файла уже
-- есть. Добавляется ровно одна ссылка и её проверка.
--
-- ── Один файл — две точки входа ─────────────────────────────────────────────
--
-- Решение из тикета: файл виден и в карточке оплаты, и во вкладке «Файлы»
-- позиции. Это не копия: строка одна, а точек входа две. Поэтому `payment_id`
-- nullable — файл позиции, не привязанный ни к какой оплате (чертёж, ТЗ,
-- договор), продолжает работать как раньше.
--
-- ── Почему не составной внешний ключ ────────────────────────────────────────
--
-- Составной FK `(payment_id, spec_item_id) → spec_item_payments (id,
-- spec_item_id)` выглядит очевидным решением (прецедент — связь факта со
-- строкой графика в `20261010_001`), но здесь он НЕ работает: `payment_id`
-- nullable, а `MATCH SIMPLE` (умолчание Postgres) пропускает строку, у которой
-- NULL стоит хотя бы в одной колонке. То есть `(NULL, spec_item_id)` не
-- проверяется вовсе, а `(payment_id, spec_item_id)` с чужой позицией — да; но
-- главное, составной FK не покрывает второй половины требования: файл и оплата
-- обязаны быть одной ОРГАНИЗАЦИИ, а `spec_item_id` её не выражает. Поэтому
-- проверка принадлежности — триггером, как `payment_sync_scope`: он читает
-- саму оплату и сверяет позицию, организацию и проект.
--
-- ── Запрет каскадного удаления ──────────────────────────────────────────────
--
-- `on delete restrict`, как у всей финансовой истории
-- (docs/adr/0004-finansovaya-istoriya-ne-udlyaetsya-kaskadom.md). Практического
-- эффекта у этого выбора два: физически удалить оплату, к которой прикреплён
-- документ, нельзя (штатный путь — мягкое удаление `deleted_at`), а удаление
-- позиции по-прежнему каскадит файлы (`spec_item_files_spec_item_id_fkey`) —
-- но не оплаты, поэтому каскад до строк файлов с непустым `payment_id`
-- дойдёт и упадёт на этом FK. Это ожидаемое поведение ADR, а не сюрприз:
-- позиция с финансовой историей физически не удаляется.
--
-- ── Поведение триггера: NULL, а не ошибка ───────────────────────────────────
--
-- Прецедент `payment_sync_scope` перезаписывает денормализованные поля, а не
-- падает. Здесь выбран тот же приём, но с одной оговоркой: расхождение означает
-- ИСПОРЧЕННУЮ ссылку, а не «поле надо подтянуть». Триггер обнуляет `payment_id`
-- (в лог уходит `raise notice`) — то есть чинит строку так, чтобы приложение
-- осталось работоспособным: файл открывается и удаляется как обычный документ
-- позиции, а не ломает UPDATE таблицы из-за чужой ссылки.
--
-- Почему не `raise exception`, хотя он заметнее: `payment_id` — ссылка на
-- ДРУГУЮ таблицу, и её актуальность может измениться без участия файла
-- (оплату отменили, позицию перенесли в другой проект). Ошибка в этом случае
-- запретила бы любое обновление строки файла — в том числе мягкое удаление
-- испорченного документа. Пользователю чужой `payment_id` отвергает ЯДРО
-- (`lib/spec/spec-item-files.ts`, `validatePaymentReference` — понятный текст
-- на форме), триггер — второй контур для записи в обход кода, и его задача
-- не пустить испорченную ссылку в БД, а не объяснить отказ.
--
-- Применение: `npx supabase db push`. Файл идемпотентен: повторный прогон
-- ничего не ломает.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ссылка на оплату
-- ---------------------------------------------------------------------------
-- `add column if not exists` — как в 20261010_001: в живом проекте таблица уже
-- существует, и файл обязан быть безопасным при повторном прогоне.
alter table public.spec_item_files
  add column if not exists payment_id uuid;

comment on column public.spec_item_files.payment_id is
  'Оплата, к которой прикреплён документ (чек, платёжное поручение, счёт). NULL — обычный файл позиции. Проверка «та же позиция, та же организация, та же живость» — триггером spec_item_files_payment_scope.';

-- Внешний ключ: `RESTRICT` (ADR 0004). Проверка по колонке, а не по имени:
-- имя в уже применённой версии могло быть любым (тот же приём, что у FK оплат).
do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any (c.conkey)
     where c.conrelid = 'public.spec_item_files'::regclass
       and c.contype = 'f'
       and a.attname = 'payment_id'
  ) then
    alter table public.spec_item_files
      add constraint spec_item_files_payment_id_fkey
      foreign key (payment_id) references public.spec_item_payments (id)
      on delete restrict;
  end if;
end $$;

-- Документы одной оплаты: список в карточке факта читается именно так.
-- Частичный индекс — строка без `payment_id` (а это большинство файлов
-- позиции) места в индексе не занимает.
create index if not exists spec_item_files_payment_id_idx
  on public.spec_item_files (payment_id)
  where payment_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Принадлежность: файл и оплата — одной позиции, организации и проекта
-- ---------------------------------------------------------------------------
-- Проверка стоит на ОБОИХ событиях, без развилки `tg_op`: ссылка обязана быть
-- верной в любой момент жизни строки, а не только при вставке. Развилка
-- «при UPDATE снимать, при INSERT падать» дала бы два разных ответа на одно и
-- то же расхождение и, главное, не защитила бы от `UPDATE`, который сам
-- приносит чужой `payment_id`.
--
-- Сверяются три величины, а не одна. Позиции мало: `org_id` и `project_id` —
-- денормализация (их подтягивает `payment_sync_scope`), и расхождение по ним
-- означало бы файл в одной организации со ссылкой на оплату в другой.
create or replace function public.spec_item_files_payment_scope()
returns trigger
language plpgsql
as $function$
declare
  v_item    uuid;
  v_org     uuid;
  v_project uuid;
begin
  if new.payment_id is null then
    return new;
  end if;

  select p.spec_item_id, p.org_id, p.project_id
    into v_item, v_org, v_project
    from public.spec_item_payments p
   where p.id = new.payment_id
     and p.deleted_at is null;

  if v_item is null
     or v_item <> new.spec_item_id
     or v_org <> new.org_id
     or v_project <> new.project_id then
    -- Отменённая оплата, чужая позиция, чужая организация, чужой проект —
    -- любое расхождение снимает ссылку, а не ломает строку файла.
    raise notice
      'spec_item_files: payment_id % не принадлежит позиции % организации % — ссылка снята',
      new.payment_id, new.spec_item_id, new.org_id;
    new.payment_id := null;
  end if;

  return new;
end
$function$;

drop trigger if exists spec_item_files_payment_scope
  on public.spec_item_files;
create trigger spec_item_files_payment_scope
  before insert or update on public.spec_item_files
  for each row execute function public.spec_item_files_payment_scope();

-- ---------------------------------------------------------------------------
-- 3. Виды документов: расширение закрытого списка категорий
-- ---------------------------------------------------------------------------
-- Категория файла была `document | texture | other` (миграция 20260927_001) —
-- одна на все документы. По решению по тикету 06 список расширяется видами,
-- которые в позиции реально накапливаются: счёт, чек, договор, ТЗ, чертёж.
-- `other` остаётся: у файла, вид которого не назван, должно быть значение, и
-- старые строки `other`/`texture` продолжают проходить проверку.
--
-- `document` СОХРАНЯЕТСЯ намеренно, хотя в интерфейсе его подписи больше нет:
-- значение уже лежит в схеме, могло быть записано в обход формы и остаётся
-- значением по умолчанию для файла, вид которого не указан.
--
-- Список продублирован в `SPEC_ITEM_FILE_CATEGORIES`
-- (lib/spec/file-content.ts) — расхождение ловит `file-content.test.ts`.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.spec_item_files'::regclass
       and contype = 'c'
       and conname = 'spec_item_files_category_check'
  ) then
    alter table public.spec_item_files
      drop constraint spec_item_files_category_check;
  end if;

  alter table public.spec_item_files
    add constraint spec_item_files_category_check
    check (
      category in (
        'document',
        'invoice',
        'receipt',
        'contract',
        'specification',
        'drawing',
        'texture',
        'other'
      )
    );
end $$;

comment on column public.spec_item_files.category is
  'Вид документа: document (общий) | invoice (счёт) | receipt (чек) | contract (договор) | specification (ТЗ) | drawing (чертёж) | texture (текстура) | other. CHECK-список синхронизирован с SPEC_ITEM_FILE_CATEGORIES (lib/spec/file-content.ts).';

commit;
