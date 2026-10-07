# Аудит файловой инфраструктуры (read-only)

Проект: `spectrack2depp` (Next.js 16 / Supabase). Изменений в код, БД, миграции и Storage
в рамках этого аудита **не вносилось**. Все выводы — по реально прочитанным файлам;
где чего-то нет — это указано явно.

---

## A. Текущая модель данных

### Таблицы

В `supabase/migrations/` создаются только:

| Миграция | Таблица |
| --- | --- |
| `20260905_001_add_spec_item_components.sql` | `spec_item_components` |
| `20260907_001_add_service_operations.sql` | `service_operations`, `service_operation_items` |
| `20260918_001_add_spec_item_events_and_comments.sql` | `spec_item_events`, `spec_item_comments` |

**Таблицы файлов, вложений или документов нет ни одной.** Нет и таблицы связи
файла со `spec_item`. Проверено поиском по `create table` / `create policy` во всех
миграциях и по списку таблиц в `lib/supabase/database.types.ts` (35 сущностей,
среди них `spec_item_files`/`files`/`attachments`/`documents` отсутствуют).

### Колонки, похожие на файловые

Единственные «файловые» колонки в схеме — две, и обе **мертвы**:

| Колонка | Тип | Где | Статус |
| --- | --- | --- | --- |
| `materials.attachments` | `string \| null` (`text`) | `database.types.ts:200,225,250` | 0 использований в коде |
| `spec_items.attachments` | `string \| null` (`text`) | `database.types.ts:1153,1195,1237` | 0 использований в коде |

`attachments` — одиночная `text`-колонка (не `jsonb`, не массив), то есть под полноценную
модель файлов не предназначена. Она:
* не входит в `SPEC_ITEM_DETAIL_FIELDS` (`lib/spec/history.ts:523-538`) — в комментарии
  на `:516-518` она прямо отнесена к «служебным» колонкам, по которым события не пишутся;
* отсутствует в `specItemPatchSchema` (`lib/validations.ts:245`, `:296`), то есть patched
  через конструктор спецификации быть не может;
* не читается ни в одном `select` (проверено grep по `*.ts`/`*.tsx`: единственные
  упоминания — сгенерированные типы, тест истории `history.test.ts:4099` и комментарий).

### Полей файла (имя, MIME, размер, путь, автор, дата) в схеме нет

Ни в `materials`, ни в `spec_items`, ни где-либо ещё нет колонок под:

* имя файла; MIME type; размер; путь в Storage;
* автора загрузки (`uploaded_by`); дату загрузки (`uploaded_at`);
* принадлежность файла к позиции спецификации.

Найдены только **URL-поля под изображение**:

| Сущность | Колонка | Что это |
| --- | --- | --- |
| `materials` | `image_url` | публичный URL картинки материала (bucket `material-images`) |
| `spec_items` | `image_url` | копия URL картинки материала на момент добавления в проект |
| `spec_item_variants` | `image_url` | картинка варианта |
| `companies` | `logo_url` | логотип (bucket `company-images`) |
| `contacts` | `avatar_url` | фото контакта (bucket `company-images`) |
| `projects` | `cover_url` | обложка проекта (bucket `project-images`) |

Ни одна из них не хранит путь в bucket, размер, MIME и автора — только URL.
Обратный разбор URL → путь есть ровно в одном месте (`storagePathFromUrl`,
`actions/contacts.ts:29-36`), и он привязан к конкретному bucket.

### Модель файла именно для позиции спецификации

**Не существует.** Файлы сейчас не привязаны ни к `spec_item`, ни (в рабочем коде) к
`materials`: единственная реализованная файловая связь — «у сущности есть одна картинка,
в БД лежит её публичный URL». Позиция спецификации лишь наследует URL картинки материала
(`actions/materials.ts:295` — `image_url: material.image_url`, а также `lib/spec/mappers.ts:35`,
где `image_url` берётся из строки или из связанного материала).

---

## B. Storage

### Buckets

Bucket'ы создаются **вручную в Supabase Dashboard**, миграций/сидов для них в репозитории
нет (это зафиксировано комментариями: `actions/contacts.ts:18-20`, `lib/material-import/storage.ts:9`).
`supabase/config.toml` содержит только глобальные настройки storage (`file_size_limit = "50MiB"`,
закомментированные примеры локальных bucket'ов), то есть **конфигурация bucket'ов вне репозитория
и не верифицируема по коду**.

Из кода известны три bucket'а (список — `actions/organization.ts:96-100`):

| Bucket | Назначение | Где определён | Публичность |
| --- | --- | --- | --- |
| `material-images` | изображения материалов | `lib/material-import/storage.ts:24` | публичный (`getPublicUrl`, `next/image`) |
| `project-images` | обложки проектов | `actions/projects.ts:125` | публичный (`getPublicUrl`) |
| `company-images` | логотипы компаний и фото контактов | `actions/contacts.ts:21` | публичный, «лимит 5 МБ, разрешены `image/*`» по комментарию |

### Структура путей

Конвенция — `<orgId>/...`, причём `orgId` всегда **из сессии**, не из аргументов
(`lib/db/guard.ts:8-12`):

| Путь | Кто пишет |
| --- | --- |
| `material-images/<orgId>/<uuid>.<ext>` | `materialImagePath`, `lib/material-import/storage.ts:82-84` |
| `project-images/<orgId>/<uuid>.<ext>` | `actions/projects.ts:151` |
| `company-images/<orgId>/companies/<uuid>.<ext>` | `actions/contacts.ts:84-85` |
| `company-images/<orgId>/contacts/<uuid>.<ext>` | `actions/contacts.ts:84-85` |

То есть **два разных уровня вложенности**: у материалов/проектов файл лежит прямо в
папке организации, у логотипов/аватаров — во вложенной подпапке. Это важно для уборки
(см. риски).

### Storage policies

**В репозитории нет ни одной storage-политики.** Поиск по `storage.objects`,
`create policy` в `*.sql` не находит ничего: все политики в миграциях относятся только к
`public.*` (spec_item_components, service_operations, spec_item_events, spec_item_comments,
organizations, organization_members, organization_invites, users). Заявленная в
`openai`-стиле «разрешены `image/*`, лимит 5 МБ» — это, по комментарию в коде, настройка
bucket'а в Dashboard, а не RLS-политика в git.

### Как реально ходят в Storage

Все операции идут **service-role клиентом** (`lib/supabase/admin.ts:4-7`,
`SUPABASE_SERVICE_ROLE_KEY`), то есть RLS Storage при записи/удалении обходится полностью,
а авторизация целиком ложится на код приложения. Anon-ключ для Storage не используется нигде
(`NEXT_PUBLIC_SUPABASE_ANON_KEY` в файловых путях не встречается).

### URL strategy

Только **public URL**: `getPublicUrl()` в `lib/material-import/storage.ts:117`,
`actions/contacts.ts:99-101`, `actions/projects.ts:162-164`.
`createSignedUrl` / `createSignedUrls` — **0 вхождений** во всём проекте.
`next.config.ts:4-6` разрешает `next/image` только `https://*.supabase.co`, то есть
публичный URL от Supabase — осознанный контракт.

### Проверка принадлежности файла организации

Проверки «этот объект Storage принадлежит моей организации» **нет как отдельной операции**.
Есть только:

1. **Префикс пути из сессии** при записи: `orgId` берётся из `requireOrgBySlug`, а не из
   формы (`actions/materials.ts:400`, `actions/projects.ts:131`, `actions/contacts.ts:66`).
2. **Уборка при удалении организации** — `removeOrganizationStorage`
   (`actions/organization.ts:229-262`): `list(orgId, { limit: 1000 })` + `remove(paths)`.
3. **Разбор URL → путь** для удаления старого изображения — `storagePathFromUrl`
   (`actions/contacts.ts:29-36`), и он применяется только к `company-images`.

Чтение файла организацией не проверяется вообще: bucket'ы публичные, а читатель — браузер.

### Риск доступа к файлам другой организации

Да, риск существует и он двойной:

* **Публичность bucket'ов.** Любой, кто знает URL, читает объект без сессии и без RLS.
  «Защита» — только непредсказуемый UUID в имени, `orgId` при этом виден в URL.
  Для картинок это, судя по `next.config.ts`, осознанное решение; для документов
  спецификации (счета, КП, спецификации поставщика) это неприемлемо.
* **Отсутствие серверной валидации принадлежности объекта.** Любой будущий action вида
  «принять `path`/`url` файла с клиента и что-то с ним сделать» (удалить, подписать,
  переименовать) без проверки префикса `orgId/` даст cross-org доступ, потому что
  клиент — service-role и никакая RLS его не остановит. Готового helper'а под такую
  проверку в проекте **нет** (есть только частный `storagePathFromUrl` для `company-images`).

---

## C. Существующая файловая логика

### Server actions / helpers

| Код | Что делает | Bucket | Проверки |
| --- | --- | --- | --- |
| `uploadMaterialImage` — `actions/materials.ts:396-424` | загрузка картинки материала из формы | `material-images` (через `storeMaterialImage`) | `record:create`; `file.type.startsWith("image/")`; ≤ 5 МБ |
| `storeMaterialImage` — `lib/material-import/storage.ts:96-119` | единая точка записи байтов в bucket + `getPublicUrl` | `material-images` | MIME известен вызывающему, `upsert: false`, путь с UUID |
| `rehostImage` — `lib/material-import/image.ts:188-224` | скачивание внешней картинки и перехостинг в bucket | `material-images` | allow-list MIME, лимит по `content-length` и по факту чтения, **sniffing сигнатуры** (`sniffImageMime`), SSRF-гарды |
| `uploadContactImage` — `actions/contacts.ts:60-103` | логотип компании / фото контакта, удаляет прежний файл | `company-images` | `record:create`; `image/*`; ≤ 5 МБ |
| `removeStoredImage` — `actions/contacts.ts:39-49` | best-effort удаление объекта по URL | `company-images` | URL должен содержать маркер bucket'а |
| `uploadProjectImage` — `actions/projects.ts:127-165` | обложка проекта | `project-images` | `record:create`; `image/*`; ≤ 5 МБ |
| `removeOrganizationStorage` — `actions/organization.ts:229-262` | уборка всех трёх bucket'ов при удалении организации | все три | `list(orgId, limit 1000)` + `remove` |

**Чего нет:** ни одного action/helper под произвольные документы — нет upload, download,
delete, rename, list, preview, нет `createSignedUrl`, нет архива/экспорта вложений.
`deleteObject` не используется; удаление везде через `storage.remove([...])`.

### UI / hooks

| Код | Что делает |
| --- | --- |
| `components/layout/material-image-field.tsx` | самое близкое к «файловому» UI: drag & drop, `input[type=file]`, превью через `URL.createObjectURL`, optimistic-показ, валидация (JPG/PNG/WebP, ≤ 5 МБ), кроп, замена/удаление, тосты |
| `components/layout/image-crop-modal.tsx` | кроп изображения перед загрузкой (`react-image-crop`) |
| `components/materials/material-dialog.tsx:225-244` | прямая загрузка картинки материала; **лимит/тип на клиенте не проверяются** — только серверные |
| `components/spec-builder/modals/manual-item-form.tsx:151-160` | загрузка картинки для позиции, добавленной вручную: тоже `uploadMaterialImage` (то есть файл позиции уже умеет попадать в `material-images`, но только как картинка и без строки-файла) |
| `components/contacts/contact-dialog.tsx:220+`, `company-dialog.tsx:168+` | то же для `company-images` |
| `components/project/project-dialog.tsx:123+` | обложка проекта |
| `components/spec-builder/modals/tabs/files-tab.tsx` | **заглушка**: иконка `Paperclip` + текст «Функция в разработке». Ни пропсов, ни загрузки |
| `components/spec-builder/modals/spec-mat-detail-modal.tsx:268, 352-354` | вкладка `files` в `TabsList` и её `ScrollableTab` вокруг `<FilesTab />` |

Хуков под файлы нет: `hooks/*` не содержит ни одного упоминания файлов, кроме строки
`"files"` в списке вкладок `use-spec-builder.ts:88`.

### Использование Storage — полный список точек

* `createSignedUrl` — **нет**.
* `getPublicUrl` — `lib/material-import/storage.ts:117`, `actions/contacts.ts:101`, `actions/projects.ts:164`.
* `upload` — `lib/material-import/storage.ts:110`, `actions/contacts.ts:89`, `actions/projects.ts:155`.
* `remove` — `actions/contacts.ts:47`, `actions/organization.ts:252`.
* `list` — `actions/organization.ts:236`.

---

## D. Что можно переиспользовать

1. **Контракт хранения `lib/material-import/storage.ts`**
   (`MATERIAL_IMAGES_BUCKET`, `MAX_IMAGE_BYTES`, `ALLOWED_IMAGE_MIME`, `extensionFromFilename`,
   `extensionForUpload`, `materialImagePath`, `storeMaterialImage`) — готовый образец
   «одна точка записи в bucket + публичный URL + `upsert: false` + UUID в имени».
   Для документов его надо переиспользовать **по идее**, а не по bucket'у: имена/лимиты
   заточены под картинки.
2. **SSRF- и MIME-гарды импортёра** — `lib/material-import/guards.ts`, `lib/material-import/image.ts`
   (лимит по факту чтения, sniffing сигнатуры). Это единственное место в проекте, где тип
   файла подтверждается содержимым, — прямой кандидат в основу серверной валидации загрузок.
3. **Уборка Storage при удалении организации** — `removeOrganizationStorage`
   (`actions/organization.ts:229-262`): сюда достаточно добавить новый bucket в
   `ORG_STORAGE_BUCKETS`, если пути будут `<orgId>/...` (но см. риск с вложенными папками).
4. **Разбор URL → путь** — `storagePathFromUrl` (`actions/contacts.ts:29-36`):
   логика обобщается в общий helper `storagePathFromUrl(bucket, url)`.
5. **UI-паттерн загрузки** — `components/layout/material-image-field.tsx` (drag & drop,
   optimistic-превью, тосты, блокировка на время загрузки) и `ImageCropModal`.
6. **Список вкладок и URL-контракт** — `DETAIL_PANEL_TABS` (`hooks/use-spec-builder.ts:81-90`)
   уже содержит `"files"`, поэтому вкладка переживает перезагрузку и «Назад» — трогать не нужно.
7. **Каркас вкладки** — `ScrollableTab` в `spec-mat-detail-modal.tsx:44-70` (свой скролл +
   сворачивание шапки) уже обёртка для `FilesTab`.

---

## E. Что отсутствует

Для полноценного блока «Файлы» в `SpecMatDetailModal` нет:

1. **Таблицы файлов позиции** (связь `spec_item` ↔ файл): ни `spec_item_files`, ни аналога.
2. **Поля пути в Storage**: в БД хранятся только публичные URL, обратный разбор URL → путь
   есть лишь для `company-images`.
3. **Метаданных файла**: имя, MIME, размер, автор, дата загрузки — нигде не хранятся
   (клиентский `FileEntry` из legacy-типов не в счёт, он был чисто браузерным).
4. **Server actions**: upload/download/delete/list для документов.
5. **Storage helper'а** для не-картиночных bucket'ов: allow-list MIME документов
   (PDF/DOCX/XLSX/DWG…), лимитов и безопасного расширения. Текущие правила картинок
   (`extensionForUpload`, дефолт `"jpg"`) для документов непригодны.
6. **Проверки, что объект принадлежит организации** (префикс `orgId/`) — нет ни helper'а,
   ни политики.
7. **Bucket'а под документы** — существующие три описаны как «изображения»: `material-images`
   (лимит 5 МБ, `image/*`), `project-images`, `company-images`. Bucket'а для PDF/CAD-файлов
   в репозитории нет; создаётся ли он где-то ещё — по коду не определить.
8. **UI**: `FilesTab` — заглушка без пропсов; нет списка, загрузки, drag & drop, иконок по
   типу, превью, скачивания, удаления, лимитов, состояний загрузки/ошибки.
9. **Домен-знаний о том, какие файлы бывают у позиции**: `FILE_CATS`/`MAP_OPTIONS` в
   `lib/constants.ts` остались от старой архитектуры и ни к чему не подключены.
10. **Событий истории** по файлам: `SPEC_ITEM_DETAIL_FIELDS` (`lib/spec/history.ts:523`)
    файловых полей не содержит, `spec_item_events` их не описывает — при добавлении файлов
    надо решить, писать ли события (иначе вкладка «Комментарии» про файлы не расскажет).
11. **Строки-файла даже там, где загрузка уже происходит.** Вкладка «Файлы» пуста не потому,
    что в проекте нет загрузки в `material-images`: `DetailsHeader` (`details-header.tsx:65-68`)
    и `manual-item-form` (`:151-160`) грузят картинку позиции тем же `uploadMaterialImage`.
    Но результат пишется в `spec_items.image_url` — одну URL-колонку. То есть «файл» существует
    как объект Storage, а как сущность БД — нет: нет строки, нет списка, нет истории, нет удаления.

### Почему сейчас показывается только empty state

`FilesTab` (`components/spec-builder/modals/tabs/files-tab.tsx`) — статический компонент без
пропсов: у него нет ни `specItemId`, ни `orgSlug`, ни загрузчика данных. В `SpecItem`
(`lib/types.ts:175-212`) нет ни списка файлов, ни счётчика, ни флага загрузки. Ни один
data loader позиции (`lib/queries.ts`, `lib/spec/mappers.ts`, `actions/specifications.ts`)
файлы не читает, потому что читать нечего — таблицы нет. То есть empty state здесь не
следствие ошибки, а прямое отражение отсутствия модели.

---

## F. Риски

### RLS / Storage security

* **Storage RLS не описан в git.** «Политики» трёх bucket'ов — настройки Dashboard
  (`actions/contacts.ts:18-20`, `lib/material-import/storage.ts:9`); проверить их по репозиторию
  невозможно, и они не версионируются вместе с кодом.
* **Двойной контур авторизации.** Данные ходят service-role клиентом
  (`lib/supabase/admin.ts`), RLS `public.*` приложением фактически не используется —
  авторизация держится на `requireOrgBySlug` + `.eq("org_id", …)`. Для файлов это
  означает, что ошибка в одном action'е = доступ к чужим данным, без страховки в БД.
* **`assertCanMutate` (`lib/db/guard.ts:6`) знает только `projects | materials | companies | contacts`** —
  `spec_items` в типе `OwnedTable` нет. Любая новая операция с файлами позиции не получит
  проверку владения «бесплатно».

### Cross-org access

* **Публичные bucket'ы = чтение без авторизации.** Для картинок это принято проектом;
  для счетов и спецификаций поставщика — нет. Если документы позиции положат в существующий
  публичный bucket, любой участник любой организации (и вообще любой человек с URL)
  прочитает файл. Обфускация UUID — не контроль доступа.
* **Клиентский `path` для удаления/подписи.** Как только появится action «удалить файл по
  пути/URL от клиента», без проверки префикса `orgId/` появится возможность удалить или
  подписать чужой объект: service-role это не остановит. Готового helper'а такой проверки
  в проекте нет — его придётся написать.

### Удаление файлов

* Удаление везде **best-effort**: ошибка Storage логируется, но транзакция БД не откатывается
  (`actions/contacts.ts:38`, `actions/organization.ts:229`). Обратный порядок (сначала файл,
  потом строка) даёт риск «строки нет — файл есть».
* **Удаление материала не удаляет его картинку**: `deleteMaterial` (`actions/materials.ts:87-101`)
  не трогает Storage; `spec_items.image_url` — вообще копия URL, поэтому один и тот же объект
  может использоваться и материалом, и позицией (и вариантами).
* **Замена изображения** удаляет только прежний файл из своего bucket'а
  (`actions/contacts.ts:96-97, 145-150`), и только если URL разобрался в путь.

### Orphaned files

* `removeOrganizationStorage` вызывает `list(orgId, { limit: 1000 })` — **ровно один уровень**,
  без `{ recursive: true }`. Файлы `company-images/<orgId>/companies/…` и
  `company-images/<orgId>/contacts/…` — это вложенные папки, и в `data` придут записи-папки
  (`id === null`), которые код явно пропускает (`actions/organization.ts:245`). То есть
  **логотипы и аватары организации при её удалении, судя по коду, не удаляются**.
* Лимит `limit: 1000` без пагинации: 1001-й объект останется.
* Файлы, потерявшие владельца (удалённый материал, удалённая позиция, неудачный апдейт),
  ничем не подчищаются: фоновой очистки, `storage.objects`-джойна или cron в проекте нет.

### Signed URL

* Механизма нет вообще (`createSignedUrl` — 0 вхождений), как и приватного bucket'а.
  Переход на документы = обязательное решение по стратегии доступа: приватный bucket +
  серверный `createSignedUrl` с коротким TTL, а не текущий `getPublicUrl`.
* Если оставить публичные URL, «скачивание» сведётся к `<a href>` на публичный объект,
  и Content-Disposition/имя файла из БД контролировать не получится (браузер возьмёт имя из
  URL, то есть UUID).

### Дублирование файла материала и файла позиции

* Сейчас связь «позиция → картинка материала» реализована **копированием URL**
  (`actions/materials.ts:295`), то есть два `spec_items` одного материала ссылаются на один
  объект Storage. Любая будущая операция «удалить файл позиции» при таком шаринге удалит
  объект у соседей — это прямой риск потери данных.
* Обратная ситуация: если для позиции сделать отдельный bucket/таблицу, а картинку
  материала показывать рядом, один и тот же визуальный файл будет существовать в двух
  моделях (картинка материала — не файл позиции), и пользователь увидит «дубль» либо
  потеряет картинку при отвязке материала. Нужно заранее решить: **ссылка на файл материала
  или независимая копия**.

### Прочее (найдено попутно, вне основной задачи)

* `uploadContactImage` (`actions/contacts.ts:83-89`) берёт расширение как
  `file.name.split(".").pop()` без нормализации, проверяя только `file.type.startsWith("image/")`.
  `image/svg+xml` проходит этот фильтр и сохраняется в публичный bucket; в
  `material-images` есть `image/svg+xml` в `EXTENSION_BY_MIME` (`lib/material-import/storage.ts:53`).
  Публично раздаваемый SVG — классический вектор stored XSS. Для документов позиции
  такой подход тем более непригоден: allow-list MIME и нормализация расширения обязательны.
* `MAX_IMAGE_BYTES` / `MAX_IMAGE_SIZE` / `MAX_PROJECT_IMAGE_SIZE` / `MAX_SIZE` — четыре
  независимые копии лимита 5 МБ в разных файлах; при добавлении файлов логику лимитов
  стоит вынести в один модуль.

---

## G. Предлагаемая целевая модель (минимальная, не реализованная)

### 1. Таблица `spec_item_files`

Минимальный набор колонок (все — новые, ни одна не существует):

| Колонка | Назначение |
| --- | --- |
| `id uuid pk` | идентификатор |
| `org_id uuid not null` | организация-владелец, источник всех проверок |
| `project_id uuid not null` | проект (денормализация ради фильтрации и каскадов) |
| `spec_item_id uuid not null` | FK на `spec_items`, `on delete cascade` |
| `storage_path text not null` | путь внутри bucket, **единственный источник истины** (не URL) |
| `file_name text not null` | исходное имя для показа и скачивания |
| `mime_type text not null` | подтверждённый MIME |
| `size_bytes bigint not null` | размер |
| `category text not null` | категория/тип: `document` / `image` / `cad` — либо под будущие `FILE_CATS` |
| `uploaded_by uuid null` | FK на `users`, автор |
| `created_at timestamptz default now()` | дата загрузки |
| `deleted_at timestamptz null` | soft-delete (как в `spec_items`/`materials`) |

Почему так:
* **`storage_path`, а не URL** — снимает необходимость разбирать URL обратно (сейчас это
  возможно только для `company-images`), позволяет менять bucket/стратегию URL, не мигрируя данные.
* **`org_id` в самой строке** — позволяет писать те же `.eq("org_id", …)`-проверки, что и везде
  в проекте (`lib/db/guard.ts:32`), и даёт RLS-политику по образцу
  `spec_item_components_select_own_org` (`20260906_002_add_spec_item_components_rls.sql:16`).
* **`deleted_at`** — совпадает с конвенцией `spec_items`/`materials` и не даёт «удалил файл —
  потерял историю».
* Дополнительные поля (например «карта текстуры» из legacy `FileEntry.map`) в минимальную
  модель не входят — только если реально понадобятся.

### 2. Bucket

Отдельный bucket под документы позиции. Решение о публичности — за продуктом, но из
аудита следует: **приватный + `createSignedUrl` на сервере** (TTL — минуты), потому что
иначе cross-org чтение счетов и КП ничем не ограничено. Пути строго:

```
<orgId>/spec-items/<specItemId>/<uuid>.<ext>
```

`specItemId` в пути — не для безопасности (её даёт префикс `orgId/`), а для уборки и отладки.
Конвенцию `orgId`-первым сегментом надо сохранить, иначе `removeOrganizationStorage`
(`actions/organization.ts:229`) не подхватит новый bucket. Уборку при удалении организации
придётся либо вызывать рекурсивно (`list(..., { recursive: true })`), либо обходить
подпапки — текущая реализация вложенные уровни не удаляет.

### 3. БД-политики

* RLS на `spec_item_files` по образцу `spec_item_components`: `select/insert/update/delete`
  с проверкой `org_id in (select org_id from organization_members where user_id = auth.uid())`
  (формулировка — как в `20260906_002_..._rls.sql`).
* Storage-политики нового bucket'а — **обязательно в миграции**, а не в Dashboard,
  чтобы они версионировались: `select` для членов организации, `insert/update/delete`
  по префиксу первого сегмента пути, равному `org_id`.

### 4. Server actions (минимальный набор)

| Action | Ответственность |
| --- | --- |
| `listSpecItemFiles(orgSlug, specItemId)` | список по `spec_item_id` + `org_id`, с проверкой, что позиция принадлежит организации |
| `uploadSpecItemFiles(orgSlug, specItemId, formData)` | проверка `record:create`, лимит размера и allow-list MIME, нормализация расширения, sniffing для картинок, путь `orgId/spec-items/<id>/<uuid>.<ext>`, вставка строки |
| `deleteSpecItemFile(orgSlug, fileId)` | soft-delete строки + best-effort `storage.remove` по `storage_path` **из БД**, не из аргумента |
| `getSpecItemFileUrl(orgSlug, fileId)` | проверка `org_id` → `createSignedUrl` с коротким TTL (или прямой публичный URL, если решено иначе) |

Общие правила — один модуль-хелпер по образцу `lib/material-import/storage.ts`:
bucket, лимит, allow-list MIME, безопасное расширение, построение пути, **и проверка
`path.startsWith(`${orgId}/`)` для любого пути, пришедшего снаружи**.

### 5. UI

* `FilesTab` получает пропсы (`orgSlug`, `specItemId`) и собственный loader; каркас
  `ScrollableTab` в `spec-mat-detail-modal.tsx:44-70` уже готов, а значение вкладки
  `"files"` уже в `DETAIL_PANEL_TABS` — URL-контракт менять не нужно.
* Разметка по образцу `material-image-field.tsx`: drag & drop зона, скрытый
  `input[type=file] multiple`, optimistic-состояние загрузки, тосты (`sonner`), список с
  иконкой типа/именем/размером (`humanSize`, `lib/utils.ts:180`), кнопки «скачать» и «удалить».
* Правила (allow-list, лимит) — из общего модуля, один источник истины и для клиента, и для сервера.

### 6. История и события

Решить явно: писать ли события в `spec_item_events` (тогда файловые поля надо добавить в
модель событий — сейчас `SPEC_ITEM_DETAIL_FIELDS`, `lib/spec/history.ts:523`, их не знает)
или показывать файлы вне ленты активности. Молчаливое решение здесь приведёт к тому, что
вкладка «Комментарии» про загрузку/удаление файлов не расскажет.

### 7. Что переиспользуется без изменений

* паттерн `scoped`/`assertCan`/`forbidden` (`lib/db/guard.ts`), `can(role, "record:create")`;
* `createAdminClient` + `.eq("org_id", …)` как контур авторизации;
* SSRF/MIME-гарды из `lib/material-import/image.ts` + `guards.ts` (если появится импорт файлов по ссылке);
* `humanSize` (`lib/utils.ts:180`), `toast`-паттерн, `ImageCropModal` — только для картинок;
* `ORG_STORAGE_BUCKETS` (`actions/organization.ts:96`) — при условии `<orgId>`-первого сегмента
  и починки рекурсивной уборки.

---

## H. Legacy-код: что делать и что не переносить

### Где legacy живёт

| Артефакт | Файл | Используется? |
| --- | --- | --- |
| `DetailsModal` с вкладкой «Файлы» | `components/spec-builder/archive/DetailsModal.tsx` | **нет** — папка `archive/` не импортируется ниоткуда (проверено grep по `archive/`) |
| `FILE_CATS`, `MAP_OPTIONS` | `lib/constants.ts:56-105` | только `DetailsModal.tsx:1` (то есть тоже никем) |
| `FileEntry`, `FileCategory` | `lib/types.ts:36-44, 69-77` | нигде |
| `SpecItem.files` | удалён из типа (был `files?: Record<string, FileEntry[]>`) | — |
| `humanSize` | `lib/utils.ts:180` | экспортируется, используется только legacy-модалкой |
| `temp/Specifications App.dc.html`, `temp/*.js`, `temp/update-modals.js`, `temp/fix-step1.js` | `temp/` | прототип/скрипты правок, вне сборки |

### Что из legacy ещё актуально (идеи, а не код)

* **Категории файлов** (`FILE_CATS`: «Схемы», «Текстуры», «Инструкции», «3D/CAD») — готовая
  продуктовая таксономия с accept-масками и текстами подсказок. Полезны как источник
  значений для колонки `category`, но подключать `lib/constants.ts` напрямую не стоит:
  набор категорий для «файлов позиции спецификации» может отличаться.
* **Разделение отображения «документ» / «текстура-картинка»** (`kind: "doc" | "tex"`):
  список строкой для документов, сетка превью для картинок — хороший UX-паттерн, он уже
  виден и в актуальных компонентах (`material-image-field`).
* **Метаданные рядом с файлом**: имя, расширение, размер (`humanSize`), дата (`at`) —
  именно тот набор, которого не хватает в БД (раздел E.3). Отображение можно повторить,
  но хранить надо в таблице, а не в браузере.
* **Счётчик файлов на вкладке** (`DetailsModal.tsx:60`) — дешёвая и полезная деталь.

### Что относится к старой архитектуре (переносить не нужно)

* **`item.files` как `Record<string, FileEntry[]>` в теле `SpecItem`** — файлы жили в
  состоянии конструктора (`ctx.addFiles` → `setItems`), без сервера и Storage. В текущей
  архитектуре состояние спецификации — это БД + optimistic-патчи; такой формы данных в ней нет.
* **Кастомная модалка** `DetailsModal.tsx` (собственный overlay, inline `style`, `z-60`) —
  заменена `Dialog`/`Tabs`/`ScrollArea` (`spec-mat-detail-modal.tsx`). Возвращаться к ней нельзя:
  в проекте есть отдельное правило (AGENTS.md) о том, что базовый `DialogContent` задаёт `grid`
  и переопределять display/flex из места вызова бесполезно — старый код это правило нарушает.
* **Клиентские `onAddFiles`/`onRemoveFile`/`onSetTextureMap` с `FileList`** — интерфейс без
  серверной семантики (нечего валидировать, нечего защищать). В новой модели нужны
  server actions с `FormData`, как в `uploadMaterialImage`.
* **`at: Date.now()`, `id: 'f'+Date.now()+random`** — идентификаторы и время из браузера.
  В новой модели `created_at`/`id` — из БД.
* **`MAP_OPTIONS`** (PBR-карты: Normal/Roughness/…) — узкоспециальная фича визуализации;
  без отдельного требования тащить её в «Файлы» не нужно.
* **Хранение превью в `background-image` из data-URL/локального состояния** — заменяется
  на публичный/signed URL, полученный с сервера.

### Чего в legacy не было вовсе (и потому не подскажет)

* прав/RLS, проверки принадлежности организации, лимитов размера, MIME-валидации;
* удаления файла из Storage (тогда его и не было), скачивания в исходном имени,
  signed URL, обработки ошибок загрузки;
* авторства и даты загрузки на сервере.

Именно этого и не хватает блоку «Файлы» сегодня, и брать это можно только из
**актуального** кода: `lib/material-import/storage.ts`, `lib/material-import/image.ts`,
`actions/contacts.ts`, `lib/db/guard.ts`, `actions/organization.ts`.
