-- ============================================================================
-- Файлы позиции спецификации: public.spec_item_files + приватный bucket
-- ============================================================================
--
-- Модель: spec_item → spec_item_files → приватный объект Storage.
--
-- Файл — самостоятельная сущность с метаданными (имя, MIME, размер, автор,
-- время), а не одна URL-колонка. До этой миграции в проекте не было ни одной
-- таблицы файлов: `spec_items.attachments` — одиночный `text`, который ни одна
-- строка кода не читает и не пишет (проверено grep по всему репозиторию), а
-- `image_url` хранит только публичный URL картинки.
--
-- Контекст архитектуры, важный для решений ниже (тот же, что у
-- spec_item_components и spec_item_events):
--
--   * приложение ходит в БД через service role (server actions) и RLS
--     обходит. Политики здесь — ВТОРОЙ контур защиты Data API от имени
--     authenticated, ровно как у spec_item_components (20260906_002);
--   * приложение использует next-auth, а не Supabase Auth, поэтому auth.uid()
--     при вызове из server actions ВСЕГДА NULL. Следствие для Storage: политики
--     ниже защищают прямое обращение к объектам с токеном Supabase Auth, а
--     рабочий путь приложения — service role из server action, где доступ
--     проверяет код (lib/spec/spec-item-files.ts + actions/spec-item-files.ts);
--   * `storage_path` — единственный источник истины о положении объекта.
--     Имя файла в Storage (UUID) и оригинальное имя (file_name) разделены
--     намеренно: оригинальное имя приходит от пользователя и в путь не попадает.
--
-- Применение: `npx supabase db push`. Миграция идемпотентна — повторный запуск
-- не создаёт ни дублей bucket'а, ни дублей политик.

-- ---------------------------------------------------------------------------
-- 1. Таблица файлов позиции
-- ---------------------------------------------------------------------------

create table public.spec_item_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null,
  spec_item_id uuid not null,

  -- Путь внутри bucket'а: `<orgId>/spec-items/<specItemId>/<uuid>.<ext>`.
  -- Формирует его ТОЛЬКО сервер (см. `buildSpecItemFilePath`): клиент не может
  -- прислать путь, поэтому и колонка не может содержать чужой объект, если
  -- только его не записал серверный код.
  storage_path text not null,

  -- Оригинальное имя для показа и скачивания. НЕ используется как часть пути.
  file_name text not null,
  -- MIME, подтверждённый сервером по содержимому там, где это возможно.
  mime_type text not null,
  size_bytes bigint not null,

  -- Категория — закрытый список первой версии, а не legacy FILE_CATS из
  -- lib/constants.ts (тот набор остался от старой архитектуры, ни к чему не
  -- подключён и сюда не переносится). Значения совпадают с
  -- SPEC_ITEM_FILE_CATEGORIES в lib/spec/file-content.ts — при добавлении
  -- категории править нужно оба места (инвариант закреплён тестом).
  category text not null,

  uploaded_by uuid,
  created_at timestamptz not null default now(),
  -- Удаление мягкое: строка остаётся, объект в Storage удаляется best-effort
  -- (стратегия зафиксирована в lib/spec/spec-item-files.ts).
  deleted_at timestamptz,

  constraint spec_item_files_org_id_fkey
    foreign key (org_id) references public.organizations (id),
  constraint spec_item_files_project_id_fkey
    foreign key (project_id) references public.projects (id)
    on delete cascade,
  -- Физическое удаление позиции уносит и строки файлов. Объекты Storage при
  -- этом НЕ удаляются автоматически: у Postgres нет способа сделать это
  -- транзакционно (объекты живут в S3-совместимом хранилище, а не в таблице),
  -- поэтому уборка объектов — отдельная операция. См. `deleteSpecItemFile` и
  -- `removeOrganizationStorage` (actions/organization.ts).
  constraint spec_item_files_spec_item_id_fkey
    foreign key (spec_item_id) references public.spec_items (id)
    on delete cascade,
  -- Автора могут удалить из users: строка файла при этом сохраняется, автор
  -- обнуляется (тот же паттерн, что у spec_item_events.actor_id).
  constraint spec_item_files_uploaded_by_fkey
    foreign key (uploaded_by) references public.users (id)
    on delete set null,

  constraint spec_item_files_category_check
    check (category in ('document', 'texture', 'other')),
  constraint spec_item_files_size_bytes_check
    check (size_bytes > 0),
  constraint spec_item_files_storage_path_check
    check (char_length(btrim(storage_path)) > 0),
  constraint spec_item_files_file_name_check
    check (char_length(btrim(file_name)) > 0),
  constraint spec_item_files_mime_type_check
    check (char_length(btrim(mime_type)) > 0)
);

-- Основной запрос блока «Файлы»: активные файлы одной позиции, свежие сверху,
-- стабильный порядок. Частичный индекс по `deleted_at is null` покрывает сразу
-- и фильтр, и сортировку (created_at desc, id desc) — отдельный индекс под
-- «только не удалённые» не нужен, он был бы префиксом этого.
create index spec_item_files_spec_item_id_active_idx
  on public.spec_item_files (spec_item_id, created_at desc, id desc)
  where deleted_at is null;

-- org_id: проверки принадлежности организации (и в RLS-политике, и в коде,
-- который дополнительно фильтрует `.eq("org_id", …)`) — тот же паттерн, что у
-- spec_item_events_org_id_idx.
create index spec_item_files_org_id_idx
  on public.spec_item_files (org_id);

-- project_id: каскад при удалении проекта и будущие выборки уровня проекта
-- (архив файлов по объекту). Не частичный: нужен и для аудита удалённых строк.
create index spec_item_files_project_id_idx
  on public.spec_item_files (project_id);

comment on table public.spec_item_files is
  'Файлы позиции спецификации. Удаление мягкое (deleted_at); объект в Storage удаляется сервером best-effort.';
comment on column public.spec_item_files.storage_path is
  'Путь объекта внутри приватного bucket''а spec-item-files: <orgId>/spec-items/<specItemId>/<uuid>.<ext>. Формируется только сервером.';
comment on column public.spec_item_files.file_name is
  'Оригинальное имя файла для показа и скачивания. В путь объекта не попадает: там UUID.';
comment on column public.spec_item_files.category is
  'Категория файла. CHECK-список синхронизирован с SPEC_ITEM_FILE_CATEGORIES (lib/spec/file-content.ts).';

-- ---------------------------------------------------------------------------
-- 2. RLS: второй контур защиты Data API
-- ---------------------------------------------------------------------------
-- Паттерн тот же, что у spec_item_components (20260906_002): доступ к строке
-- есть только у участников организации строки, и дополнительно org_id строки
-- сверяется с org_id родительской позиции — внешний ключ не гарантирует «одна
-- организация на всю цепочку».
--
-- Запись (insert/update/delete) политиками НЕ разрешена намеренно: файл — это
-- пара «строка БД + объект Storage», и создать её согласованно может только
-- серверный код, который сам формирует storage_path и подтверждает MIME по
-- содержимому. Прямая вставка строки через Data API дала бы файл-фантом: строка
-- есть, объекта нет. Ровно поэтому у spec_item_events тоже нет write-политик.

alter table public.spec_item_files enable row level security;

drop policy if exists "spec_item_files_select_own_org" on public.spec_item_files;
create policy "spec_item_files_select_own_org"
  on public.spec_item_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      join public.spec_items s on s.id = spec_item_files.spec_item_id
      where m.user_id = auth.uid()
        and m.org_id = spec_item_files.org_id
        and s.org_id = spec_item_files.org_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Bucket spec-item-files: приватный, версионируется миграцией
-- ---------------------------------------------------------------------------
-- Bucket создаётся здесь, а НЕ в Dashboard: конфигурация доступа должна жить в
-- git вместе с политиками (существующие три bucket'а проекта созданы вручную, и
-- проверить их политики по репозиторию невозможно — это отмечено в аудите).
--
-- storage.buckets — таблица сервиса Storage; Supabase документирует её как
-- read-only для пользовательских данных (метаданные объекта, а не сам объект),
-- но строка bucket'а — это конфигурация, и единственный способ положить её в
-- миграцию. INSERT идемпотентен по первичному ключу (`id`).
--
-- public = false: счета, КП и спецификации поставщика не должны читаться по
-- публичной ссылке. Доступ выдаётся только короткоживущим signed URL, который
-- создаёт сервер после проверки принадлежности файла организации.
--
-- Лимит и allow-list дублируют серверные правила из lib/spec/file-content.ts
-- (MAX_SPEC_ITEM_FILE_BYTES, SPEC_ITEM_FILE_MIME_TYPES). Дубль намеренный: это
-- второй контур на уровне Storage, он срабатывает даже если код обойдут.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'spec-item-files',
  'spec-item-files',
  false,
  26214400,
  array[
    -- документы
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/plain',
    'text/csv',
    -- изображения и текстуры (SVG намеренно отсутствует: это XML со скриптами)
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/tiff',
    -- CAD / 3D
    'image/vnd.dwg',
    'image/vnd.dxf',
    'model/gltf+json',
    'model/gltf-binary',
    'model/obj',
    'application/octet-stream',
    'application/zip'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Storage policies: принадлежность объекта организации
-- ---------------------------------------------------------------------------
-- Первый сегмент имени объекта — это orgId (конвенция всего проекта:
-- `materialImagePath`, `uploadProjectImage`, `uploadContactImage` кладут файлы
-- в `<orgId>/...`). Политики ниже разрешают доступ ТОЛЬКО к своему сегменту.
--
-- `storage.foldername(name)` возвращает массив папок (всё, кроме имени файла),
-- поэтому `(storage.foldername(name))[1]` — первый сегмент пути.
--
-- Как и у таблицы, write-политик нет: запись и удаление объектов выполняет
-- серверный код под service role, а он RLS обходит. Если появится браузерная
-- загрузка напрямую в Storage (signed upload), политики INSERT/UPDATE/DELETE
-- нужно будет добавить вместе с ней и с проверкой роли (viewer не должен
-- загружать) — ровно как это сделано для spec_item_comments_insert_member.

drop policy if exists "spec_item_files_objects_select_own_org" on storage.objects;
create policy "spec_item_files_objects_select_own_org"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'spec-item-files'
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "spec_item_files_objects_insert_own_org" on storage.objects;
create policy "spec_item_files_objects_insert_own_org"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'spec-item-files'
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id::text = (storage.foldername(name))[1]
        -- Наблюдателю запись запрещена: та же граница, что у
        -- `can(role, "record:create")` в lib/permissions.ts.
        and m.role <> 'viewer'
    )
  );

drop policy if exists "spec_item_files_objects_delete_own_org" on storage.objects;
create policy "spec_item_files_objects_delete_own_org"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'spec-item-files'
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id::text = (storage.foldername(name))[1]
        and m.role <> 'viewer'
    )
  );
