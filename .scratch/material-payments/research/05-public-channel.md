# 05. Публичный канал спецификации: устройство и механизмы видимости

**Предмет:** как устроена публичная ссылка `/share/spec/<token>` и что она уже умеет скрывать, чтобы решить, как добавить ОПЦИОНАЛЬНЫЙ показ платежей клиенту.
**Источники:** код — `путь:строка`; живая схема — [00-postgrest-schema-raw.txt](00-postgrest-schema-raw.txt) и [01-schema-from-db.md](01-schema-from-db.md) (снято ранее, не перепроверялось); **[П]** — предположение, а не прочитанный код. Прикладной код и БД не менялись.

## Резюме

1. Публичный канал — токен-capability: строка `public_links` + две точки входа (`/share/spec/<token>`, `/api/spec-pdf/<token>`), вне auth-middleware (`proxy.ts:8-10`), чтение service-role клиентом (`lib/spec/public-spec.ts:50`, `lib/supabase/admin.ts:4-13`).
2. Ссылка создаётся в одном месте — `generatePublicLink` (`actions/spec-export.ts:239-266`); кнопка PDF делегирует туда же (`:268-275`), то есть «PDF» тоже создаёт публичную ссылку, и по её токену доступна HTML-страница.
3. `type`: CHECK в БД допускает `'spec'` и `'pdf'` (`01-schema-from-db.md:339`), код пишет и читает только `'spec'` (`actions/spec-export.ts:255`, `lib/spec/public-spec.ts:58`).
4. `expires_at` — жёстко 7 дней при вставке (`actions/spec-export.ts:247-249`), проверяется при чтении (`lib/spec/public-spec.ts:62`). Отзыва нет: по `public_links` во всём репозитории только INSERT и SELECT.
5. `client_view` читается **в одном** месте (`lib/spec/public-spec.ts:265`) и **не меняет состав данных**: запросы одинаковы для обоих режимов (`:69-81, 87-99, 151-162, 204-211`). Меняется только показ: бейдж «Коммерческое предложение», полоса служебных статусов, марка/код и статус позиции.
6. Закупочную цену, скидку поставщика и маржу скрывает **не** `client_view`, а сама публичная модель: `supplierDiscountPct: 0` (`lib/spec/public-spec.ts:117`), `notes: ""` (`:131`), состав без id/компаний (`:149-195`). `margin` и `purchaseTotal` не рендерятся нигде (см. §3).
7. Механизм «показывать/не показывать раздел» один и не про флаги: секция рисуется, если в ней есть данные — `byType.filter((g) => g.count > 0)` (`app/share/spec/[token]/page.tsx:47`), `nodes && …` (`components/spec-builder/summary/summary-item-row.tsx:19,113`).
8. Файлов и картинок публично нет вовсе: `image_url`/`product_url` не выбираются (`lib/spec/public-spec.ts:72-76`) и обнулены (`:130,136`), PDF не импортирует `Image` (`lib/spec/pdf-document.tsx:2`), bucket `spec-item-files` приватный и только для `authenticated` (`supabase/migrations/20260927_001_add_spec_item_files.sql:176-216, 234-247`).
9. Тестов у публичного канала нет: у `lib/spec/public-spec.ts` и `actions/spec-export.ts` нет ни unit-, ни интеграционных тестов (единственное упоминание — комментарий `lib/permissions.test.ts:485`).
10. Рекомендация (§6): новая колонка `public_links.show_payments boolean not null default false`, выставляемая при выпуске ссылки — нулевой ретроактивный эффект и минимальный радиус изменений.

---

## 1. Где и как создаются публичные ссылки

**Единственный создатель.** `generatePublicLink(orgSlug, projectId, opts)` — `actions/spec-export.ts:239-266`: `requireOrgBySlug` (`:244`), admin-клиент (`:245`), токен `crypto.randomUUID()` (`:248`), TTL 7 дней (`:249`), INSERT (`:251-258`), `type: "spec"` (`:255`), `client_view: opts.clientView === true` (`:256`), `expires_at` (`:257`), текст ошибки (`:260-263`). Модель описана в комментарии: токен — capability, страницу и PDF открывает любой, пока не истёк срок (`:223-238`).

**Отзыв и авторство отсутствуют.** grep `from("public_links")` даёт ровно два вхождения: INSERT (`actions/spec-export.ts:251`) и SELECT (`lib/spec/public-spec.ts:53`). Ни UPDATE, ни DELETE, ни «отозвать» (единственный `revoke*` — `actions/teams.ts:292` про приглашения). Комментарий это признаёт: «в `public_links` нет `created_by`, а UI не умеет отзывать ссылку» (`actions/spec-export.ts:236-237`). Очистки истёкших ссылок нет (в корне репозитория нет `vercel.json`/cron).

**Тип ссылки.** `public_links_type_check`: `type = ANY (ARRAY['spec','pdf'])` (`01-schema-from-db.md:339`). Код пишет `"spec"` (`actions/spec-export.ts:255`) и читает с фильтром `.eq("type", "spec")` (`lib/spec/public-spec.ts:58`). Значение `'pdf'` не пишется и не читается нигде — что оно значило, из репозитория не видно.

**PDF — та же ссылка.** `generateSpecPdf` не отдаёт файл, а вызывает `generatePublicLink` (`actions/spec-export.ts:268-275`, комментарий `:234-235`); UI открывает `/api/spec-pdf/<token>` (`components/spec-builder/summary/spec-summary.tsx:154-164`), а роут читает ту же строку через `loadPublicSpec` (`app/api/spec-pdf/[token]/route.tsx:14`). Следствие: нажатие «PDF» увеличивает число публичных ссылок.

**Накопление и права.** Каждый вызов = новая строка (`actions/spec-export.ts:234-237, 251`); ограничения на число активных ссылок и на перевыпуск нет — цикл «Поделиться/PDF» создаёт неограниченное число валидных 7-дневных токенов. Право не проверяется: публикация отнесена к чтению, поэтому даже `viewer` может создать ссылку — осознанно (`lib/permissions.ts:19-25`).

**UI-точка.** Сводка: «Поделиться» (`components/spec-builder/summary/spec-summary.tsx:166-190`) и «PDF» (`:154-164`) → `generatePublicLink`/`generateSpecPdf` (импорт `:26-30`), URL `${location.origin}/share/spec/${token}` (`:175`); сводка монтируется в билдере (`components/spec-builder/spec-builder.tsx:75-76, 707`). Кнопки «Поделиться» на карточках/строках (`components/spec-builder/layout/spec-item-actions.tsx:73-78`, `components/spec-builder/spec-row.tsx:262-267`) публичных ссылок **не** создают: `shareItem` собирает якорь `${location.pathname}#item=<id>` (`hooks/use-spec-builder.ts:1410-1422`).

**Чтение.** `loadPublicSpec(token)` — `lib/spec/public-spec.ts:47-268`: SELECT ссылки с join на `projects` (`:52-59`), проверка `expires_at` (`:62`), затем позиции, варианты, состав, операции. Маршруты: `app/share/spec/[token]/page.tsx:19-22`, `app/api/spec-pdf/[token]/route.tsx:13-16`; роуты вне middleware — matcher исключает `api` и `share` (`proxy.ts:8-10`).

## 2. Семантика `client_view`: все использования

Полный список (grep `client_view`/`clientView`): **запись** — `actions/spec-export.ts:256`; поле опций `actions/spec-export.ts:25` и ветка Excel/PDF `:107`; **SELECT и единственное чтение из БД** — `lib/spec/public-spec.ts:55, 265`; тип — `lib/spec/public-spec.ts:33` и `lib/supabase/database.types.ts:609, 618, 627`; потребители — `app/share/spec/[token]/page.tsx:24, 66-68, 83, 122`, `app/api/spec-pdf/[token]/route.tsx:24, 32`, `lib/spec/pdf-document.tsx:219, 230, 261, 288-294, 317-329, 334, 387, 398, 411, 439`, `components/spec-builder/summary/summary-item-row.tsx:9, 13, 27, 32, 62, 77, 101, 114, 126, 138, 152, 166, 207`, `components/spec-builder/summary/spec-summary.tsx:57, 134, 157, 169, 187, 252-264, 291, 333, 368`.

Что меняет флаг в публичном канале:

* бейдж «Коммерческое предложение» — `app/share/spec/[token]/page.tsx:66-68`; в PDF `lib/spec/pdf-document.tsx:261`;
* полосу служебных статусов — `app/share/spec/[token]/page.tsx:83-105` (при `clientView` не рисуется);
* марку (код) позиции — `summary-item-row.tsx:32-36` (таблица), `:77-81` (карточка); в PDF `lib/spec/pdf-document.tsx:288-292`, а колонка `cCode` исчезает, имя расширяется до `cNameWide` (`:121, 294`);
* статус позиции (точка + подпись) — `summary-item-row.tsx:62-69, 101-108`; в PDF `pdf-document.tsx:317-329`;
* код связанной позиции внутри состава — `summary-item-row.tsx:207-211`; в PDF `pdf-document.tsx:439-441`.

Чего флаг **не** меняет: состав данных публичной модели. Все запросы идут до ветвления и от флага не зависят (`lib/spec/public-spec.ts:69-81, 87-99, 151-162, 204-211`); `clientView` появляется только в объекте результата (`:265`). То есть «клиентская» и «рабочая» ссылки содержат одни и те же поля, различия — только в разметке. Закупочную цену, скидку поставщика, маржу и заметки флаг не скрывает: их скрывает публичная модель, всегда и независимо от режима (§3).

Иначе флаг работает в Excel: он реально меняет набор колонок — убирает «Марка», «Артикул», «Статус», «Поставщик», «Помещения», «Заметки» (`actions/spec-export.ts:28-52`), подрядчика и заметки операций (`:149-152`), плюс ширины колонок (`:186-210`) и суффикс имени файла (`:217-218`).

## 3. Что публичная страница показывает и что скрывает

**Скрытие закупки/маржи — свойство модели, а не UI.** Публичная позиция собирается вручную (`lib/spec/public-spec.ts:101-142`): `supplierDiscountPct: 0` с комментарием «клиенту не отдаём никогда» (`:117`), `notes: ""` (`:131`), контакты/компания — заглушки (`:124-129`), из БД берётся только активный вариант через `applyActiveVariant` (`:83-99, 104`). `priceOf` считает `purchaseTotal`/`margin` из `supplierDiscountPct` (`lib/spec/pricing.ts:41-56`), то есть при нуле они равны `total`/`0`. Но ни `purchaseTotal`, ни `margin`, ни `discountAmount` не рендерятся ни в одном компоненте: grep по `.tsx` даёт только CSS-свойства `margin*` (`lib/spec/pdf-document.tsx:62-195`), а единственное употребление `discountAmount` в разметке — подсказка рабочей строки (`components/spec-builder/spec-row.tsx:210`). Отдельного «скрытия маржи» в публичном коде нет, потому что публичный рендер её не читает. Скидка клиента, наоборот, применяется к показываемой цене: `clientDiscountPct: Number(r.client_discount_pct ?? 0)` (`lib/spec/public-spec.ts:116`), `priceFinal = priceBase * (1 − cd/100)` (`lib/spec/pricing.ts:41`), печатается `p.priceFinal`/`p.total` (`summary-item-row.tsx:54-59`).

**Заметки и служебные поля.** Заметки позиции — пустая строка (`lib/spec/public-spec.ts:131`); поставщик есть только снимком имени (`:120`) и печатается лишь в рабочем Excel (`actions/spec-export.ts:47`); `rooms` в модель попадают (`:121`), но публичный рендер их не выводит (в `app/share/spec/[token]/page.tsx` и `summary-item-row.tsx` нет упоминаний `rooms`).

**Служебные статусы закупки/подбора.** Статус приходит в модель (`lib/spec/public-spec.ts:118`) и участвует в агрегации полосы (`app/share/spec/[token]/page.tsx:29-41`), но при `clientView` полоса скрыта (`:83`), а подпись и точка в строке — `summary-item-row.tsx:62-69`. Плейсхолдеры отфильтрованы (`lib/spec/public-spec.ts:102`), подписи — из `SPEC_STATUS_CONFIG` (`lib/spec/status.ts:13-54`: «Не выбрано», «Подобрано», «Согласовано», «Заказано», «Доставлено», «Заменить»).

**Операции проекта.** Модель отдаёт подрядчика и заметки (`lib/spec/public-spec.ts:250-254`), но страница их не печатает: блок бюджета выводит только агрегаты `serviceBudgetRows(...)` (`app/share/spec/[token]/page.tsx:141-153`, `lib/spec/project-budget.ts:105-129`), PDF — те же строки (`lib/spec/pdf-document.tsx:350-355`). Имена подрядчиков и заметки операций видны лишь в рабочей сводке при `!clientView` (`components/spec-builder/summary/spec-summary.tsx:368-373`) и в Excel (`actions/spec-export.ts:149-152`).

**Механизм «показывать/не показывать раздел».** Отдельного нет — только inline-условия `!clientView` (§2) и общий приём «секция рисуется, если есть данные»: `byType.filter((g) => g.count > 0)` (`app/share/spec/[token]/page.tsx:47`, `lib/spec/pdf-document.tsx:245`), `byStatus.length > 0` (`:83`), `nodes && composition.length > 0` (`summary-item-row.tsx:19, 113`), `opsGrouped.length > 0` (`spec-summary.tsx:341`). Это ровно шаблон для опционального блока: «рендерить, если включено И есть строки». При этом модель отдаёт больше, чем печатается (подрядчик, заметки операций, `rooms`): сегодня это не утечка, но каждый новый рендер сам решает, что выводить.

## 4. Файлы и изображения в публичном канале

**Картинок нет.** Публичный SELECT по `spec_items` (`lib/spec/public-spec.ts:72-76`) не содержит `image_url` и `product_url`, хотя колонки в БД есть (`00-postgrest-schema-raw.txt:283-284`); в собранном объекте они заглушены — `imageUrl: null` (`:130`), `product_url: ""` (`:136`). Ни `app/share/spec/[token]/page.tsx`, ни `summary-item-row.tsx` не рисуют изображений; `lib/spec/pdf-document.tsx:2` импортирует `Document, Page, Text, View, StyleSheet` — **без** `Image`, поэтому PDF сейчас физически не может вставить картинку. В рабочем билдере картинка позиции — это `item.imageUrl` (`lib/spec/mappers.ts:35`: `r.image_url ?? material.image_url`) и `next/image` (`components/spec-builder/spec-row.tsx:101-103`).

**Документов (`spec-item-files`) в публичном канале нет ни в каком виде.** Bucket создан приватным (`supabase/migrations/20260927_001_add_spec_item_files.sql:176-216`; комментарий `:169-171`: «счета, КП и спецификации поставщика не должны читаться по публичной ссылке»). Политика SELECT на `storage.objects` выдана только роли `authenticated` и требует членства в организации по первому сегменту пути (`:234-247`). Единственная выдача — короткоживущий signed URL: `getSpecItemFileUrl` (`lib/spec/spec-item-files.ts:505-554`, TTL 5 минут `:548`), вызов только из защищённой вкладки (`components/spec-builder/modals/tabs/files-tab.tsx:333`). Категории — `document | texture | other` (`supabase/migrations/20260927_001_add_spec_item_files.sql:58, 85-86`). Колонка `spec_items.attachments` (`00-postgrest-schema-raw.txt:281`) в коде не читается (кроме перечней «неизменяемых» полей истории: `lib/spec/history.ts:517`).

**Чего не хватает, если файлы/картинки понадобятся публично** (ни одного из трёх путей сегодня нет):
1. **Публичный bucket** — противоречит решению миграции (`:169-171`): счета и КП станут доступны по угадываемому URL. Для отобранных вручную картинок это отдельный публичный bucket, но не переиспользование `spec-item-files`.
2. **Серверный `createSignedUrl` при рендере публичной страницы** — техника в проекте уже есть (`lib/spec/spec-item-files.ts:551`), а service-role клиент доступен в публичном коде (`lib/spec/public-spec.ts:50`, `lib/supabase/admin.ts:4-13`). Тогда TTL подписи ≥ времени жизни страницы, а путь обязательно сверять с ожидаемым префиксом (образец — `lib/spec/spec-item-files.ts:537-546`).
3. **Прокси-роут** `/api/spec-file/<token>/<fileId>` по образцу `app/api/spec-pdf/[token]/route.tsx:9-16`: токен → `org_id`/`project_id` → принадлежность файла позиции проекта, затем стрим (в PDF-роуте сейчас `Cache-Control: no-store`, `:33`).

Для картинок материалов путь проще: bucket `material-images` публичный и отдаётся `getPublicUrl` (`lib/material-import/storage.ts:117`; вторично — `temp/files-audit.md:91`), поэтому достаточно вернуть `image_url` в публичный select и пробросить в компонент. Но это изменение контракта публичной модели.

## 5. Какие ещё механизмы «клиентского вида» существуют

* **`projects.client_name`** — единственное «клиентское» поле проекта в публичном канале (`lib/spec/public-spec.ts:55`), печатается в шапке (`app/share/spec/[token]/page.tsx:54-58`, `lib/spec/pdf-document.tsx:253-254`), задаётся в формах (`components/project/project-dialog.tsx:273`, `lib/validations.ts:138`).
* **Настроек проекта, влияющих на публичный вид, нет.** У `projects` есть `accent_color`, `status`, `budget`, `address`, `type`, `cover_url` (`00-postgrest-schema-raw.txt:117-132`), но публичный select читает только `title` и `client_name` (`lib/spec/public-spec.ts:55`); `accent_color` в публичной вёрстке не применяется (`app/share/spec/[token]/page.tsx:50-166` — классы темы), `cover_url` — только карточка проекта (`components/project/project-card.tsx:51-54`).
* **Клиентского/гостевого доступа и отдельных представлений нет**: «гостевого/клиентского доступа в системе пока нет» (`lib/permissions.ts:9-13`); единственные публичные маршруты — `/share/spec/<token>` и `/api/spec-pdf/<token>`.
* **Параметров запроса и фильтров у публичной страницы нет**: `Props = { params: Promise<{ token: string }> }` (`app/share/spec/[token]/page.tsx:17`), `searchParams` не используется. Фильтры (`filters.query`, `activeType`, `statusFilter`) живут только в билдере (`hooks/use-spec-builder.ts:1431-1444`).
* **Локальный UI-переключатель** «Версия для клиента / Рабочая версия» — `useState(false)` (`components/spec-builder/summary/spec-summary.tsx:57`, кнопка `:246-266`), между открытиями не сохраняется, но прокидывается в оба action'а (`:133-135, 156-158, 168-170`) и служит предпросмотром (`:291, 333, 368`).
* **Публичная модель как «безопасная проекция»**: активный вариант (`lib/spec/public-spec.ts:83-99`), фильтр плейсхолдеров (`:102`), состав без id и компаний (`:144-195`), заглушки вместо служебных полей (`:124-139`). Отдельно: `shareItem` — не публичная ссылка, а якорь `#item=<id>` (`hooks/use-spec-builder.ts:1410-1422`).

## 6. Оценка: как добавить опциональный раздел «Платежи» наименее инвазивно

Рамка для всех вариантов: платежей в БД и коде нет (`research/03-procurement-ui.md:11`; черновик схемы — `migration-draft.sql:90-117, 141-167`), публичное чтение идёт service-role клиентом (`lib/spec/public-spec.ts:50`), поэтому RLS на новых таблицах публичный канал не ограничивает — скоуп задаёт запрос: выборка по `link.project_id` **и** `link.org_id` (образец — `lib/spec/public-spec.ts:78-79, 209-210`). Общий минимум: новый блок в `app/share/spec/[token]/page.tsx` и `lib/spec/pdf-document.tsx`, проброс через `PublicSpec` (`lib/spec/public-spec.ts:26-35`) и `app/api/spec-pdf/[token]/route.tsx:18-27`.

| | (а) `client_view` | (б) новая колонка `public_links` | (в) настройка `projects` | (г) ничего не хранить |
| --- | --- | --- | --- | --- |
| Данные | ничего | 1 колонка + `database.types.ts:607-634` | 1 колонка + типы + `projectSchema` (`lib/validations.ts:135-152`) | ничего |
| Код | только запрос и рендер | `ExportOpts` (`actions/spec-export.ts:25`), INSERT (`:251-258`), SELECT (`lib/spec/public-spec.ts:52-59`), `PublicSpec` (`:26-35`), возврат (`:260-267`), 2 рендера | то же + `ProjectInput`/`EditableProject`/`toProjectInput` (`components/project/edit-project-dialog.tsx:14-40`), форма `project-dialog.tsx`, select проекта (`public-spec.ts:55`) | только рендер |
| Где toggle | не нужен: уже есть кнопка «Версия для клиента» (`spec-summary.tsx:246-266`) | второй переключатель рядом (`spec-summary.tsx:205-267`) + state (`:57`) | «Редактировать проект» (`components/project/edit-project-dialog.tsx:47-51`) | нет |
| Смысл | «клиентская версия = с платежами» | решение по каждой ссылке | политика проекта | платежи видны всегда, как только появились |
| Уже выпущенные ссылки | все `client_view = true` сразу показывают платежи; `false` — никогда | `default false` → ничего не меняется | подчиняются настройке проекта ретроактивно: включение/выключение действует на все живые ссылки | все начинают показывать платежи, отменить нельзя |

**Рекомендация: вариант (б).** Переключатель одной фразой: **булево поле `public_links.show_payments boolean not null default false`, выставляемое вторым тумблером рядом с «Версия для клиента» в момент выпуска ссылки.**

Обоснование:
1. **Ссылка уже единица публикации**, и оба её «режимных» свойства фиксируются при вставке: `expires_at` и `client_view` (`actions/spec-export.ts:247-258`). `show_payments` — третье свойство того же акта, а не новый разговор о настройках проекта.
2. **Нулевой ретроактивный эффект.** `default false` + сравнение `=== true` (образец — `lib/spec/public-spec.ts:265`) означают, что все выпущенные ссылки, включая созданные кнопкой PDF (`actions/spec-export.ts:268-275`), остаются ровно такими же. Для таблицы, у которой RLS выключен и `anon` имеет SELECT (`01-schema-from-db.md:21`), «новая колонка ничего не включает по умолчанию» важнее удобства.
3. **Минимальный радиус.** Не трогаются `projects`, его zod-схема (`lib/validations.ts:135-152`) и диалоги проекта; правки локальны: один action, публичная модель, два рендера, типы.
4. **Форма ввода уже существует.** `ExportOpts` (`actions/spec-export.ts:25`) уже несёт `clientView` через оба action'а, поэтому второй флаг едет тем же путём; панель переключателей в сводке тоже есть (`components/spec-builder/summary/spec-summary.tsx:205-267`).
5. **Совместимо с (в) как следующим шагом.** Если понадобится менять решение после выпуска, `projects.show_payments_to_client` вводится как «значение по умолчанию для новых ссылок», не меняя чтение: приоритет решается в одном месте (`lib/spec/public-spec.ts:260-267`).
6. **Чего не дают (а) и (г).** (а) смешивает «клиентскую вёрстку» с «показом платежей»: выдать КП без платежей станет невозможно, а рабочая ссылка не покажет их никогда — при том что сегодня состав данных у обоих режимов одинаков (§2). (г) не является опциональным показом вовсе: включить его нельзя, выключить тоже.

Заметки к реализации (границы, а не код):
* Публичный блок должен отдавать только отобранные поля. В черновике схемы у факта есть `comment`, `created_by`, `author_name_snapshot` (`migration-draft.sql:151, 155-159`), у плана — `condition`, `due_date` (`:96-100`). Прецедент отбора — `supplierDiscountPct: 0` и `notes: ""` (`lib/spec/public-spec.ts:117, 131`), состав без id (`:144-195`).
* Рендер по шаблону «секция, если есть данные» (`app/share/spec/[token]/page.tsx:47`, `summary-item-row.tsx:19, 113`), то есть `show_payments && rows.length > 0`.
* Кнопка PDF ведёт в тот же флаг: `generateSpecPdf` → `generatePublicLink` (`actions/spec-export.ts:268-275`), иначе HTML и PDF одной ссылки разойдутся.
* Тестов на публичный канал нет (Резюме.9) — правка входит без страховки; минимальный разумный шаг — unit-тест на `loadPublicSpec` с подставным клиентом (образцы моков — `integration/spec-item-files.int.test.ts:112-116`).

## Открытые вопросы

1. **Что означает `public_links.type = 'pdf'`?** CHECK это допускает (`01-schema-from-db.md:339`), но код пишет только `'spec'` (`actions/spec-export.ts:255`) и читает только `'spec'` (`lib/spec/public-spec.ts:58`). Есть ли такие строки в живой БД и кто их создаёт — из репозитория не видно.
2. **Есть ли фактический DEFAULT у `client_view` и как он влияет на старые строки?** В генерированных типах `client_view` необязателен при INSERT (`lib/supabase/database.types.ts:617-625`), что для NOT NULL-колонки означает наличие default, но какое именно значение — нужно смотреть в БД.
3. **Продуктовое решение:** показ графика платежей клиенту — часть «клиентской версии» (тогда (а)) или отдельное решение по каждой ссылке (тогда (б))? От этого зависит вывод §6.
4. **Что именно показывать:** только график (`spec_item_payment_plans`) или ещё и факты оплат (`spec_item_payments`)? Черновик разделяет их намеренно (`migration-draft.sql:90-117, 141-167`; `docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md:3`).
5. **Нужны ли публично документы** (счёт/поручение, скан)? В черновике они отложены «вместе с публичным показом» (`migration-draft.sql:152-153`) и упираются в отсутствие механизма файлов (§4).
6. **Нужен ли отзыв ссылки и `created_by`?** Сейчас нет ни того, ни другого (`00-postgrest-schema-raw.txt:134-141`; grep — только INSERT и SELECT), TTL 7 дней не настраивается (`actions/spec-export.ts:249`). Если платежи чувствительнее статусов, отзыв и авторство логично добавлять вместе с ними (`actions/spec-export.ts:236-237`).
7. **Одна ссылка на проект или много?** Каждый выпуск создаёт новую строку (`actions/spec-export.ts:251`), поэтому при варианте (в) настройка проекта действует на все живые токены сразу — приемлемо ли это.
