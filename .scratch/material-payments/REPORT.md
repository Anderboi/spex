# Этап 1. Архитектура оплаты материалов: исследование и модель платежей

**Статус:** исследование завершено, код и БД не менялись. Черновик миграции — [migration-draft.sql](.scratch/material-payments/migration-draft.sql), **не выполнять**.
**Доказательная база:** [research/](.scratch/material-payments/research) — четыре отчёта по коду и два снимка живой схемы.
**Принятые решения:** двадцать одно, по четырём кругам интервью (см. [Приложение А](#приложение-а-решения-интервью)).
**Документы, созданные по итогам:** термины в [GLOSSARY.md](GLOSSARY.md), ADR [0003](docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md) и [0004](docs/adr/0004-finansovaya-istoriya-ne-udlyaetsya-kaskadom.md).

---

## 1. Фактическая архитектура и перечень изученных файлов

### 1.1 Как устроено

Приложение — Next.js App Router поверх Supabase (Postgres) с **одним** клиентом Supabase: service-role ([research/03](.scratch/material-payments/research/03-procurement-ui.md), `lib/supabase/admin.ts:4`). Аутентификация — next-auth v5 (Auth.js) с JWT-стратегией; Supabase Auth сессии не выдаются, поэтому `auth.uid()` в проде всегда NULL, а RLS-политики оказываются страховкой, а не рабочим механизмом доступа. Права проверяются в TypeScript (`lib/permissions.ts`, `lib/db/guard.ts`).

### 1.2 Модель данных (снята из `pg_catalog`, не из типов)

```
organizations ──< organization_members (role: owner|admin|member|viewer)
      │
      └──< projects (deleted_at, budget integer) ──< spec_items (deleted_at, status, price, qty, скидки, запас)
                    │                                   │
                    │                                   ├──< spec_item_components   (RESTRICT на ref_spec_item_id)
                    │                                   ├──< spec_item_events       (журнал, payload jsonb)
                    │                                   ├──< spec_item_comments     (deleted_at, автор)
                    │                                   ├──< spec_item_files        (deleted_at, uploaded_by)
                    │                                   └──< spec_item_variants
                    └──< service_operations (amount numeric, deadline date, completed) ──< service_operation_items
materials (библиотека, deleted_at) ──> spec_items.material_id (SET NULL)
```

Факты, важные для этой задачи (все — из [research/01-schema-from-db.md](.scratch/material-payments/research/01-schema-from-db.md) и [research/00-postgrest-schema-raw.txt](.scratch/material-payments/research/00-postgrest-schema-raw.txt)):

- `spec_items`: `price numeric(12,2)`, `qty numeric(10,2)`, `stock_pct/client_discount_pct/supplier_discount_pct numeric(5,2)`; `status` — enum `draft|picked|approved|ordered|delivered|replace`; есть `deleted_at`; **нет `created_by`**.
- Живые триггеры (8): `spec_items_sync_org_trg` (BEFORE INSERT/UPDATE) перезаписывает `spec_items.org_id` из `projects`; `set_spec_items_updated_at` и `trg_touch_projects` и т.п. вызывают `handle_updated_at()`/`touch_updated_at()`.
- Внешние ключи детей `spec_items` — `ON DELETE CASCADE`; исключения: `spec_items.parent_id` и `spec_item_components.ref_spec_item_id` → `RESTRICT`.
- Мягкое удаление есть у `spec_items`, `projects`, `materials`, `spec_item_comments`, `spec_item_files`.
- Денежные колонки: `spec_items.price numeric(12,2)`, `materials.price numeric(12,2)`, но `service_operations.amount numeric` (без typmod) и `spec_item_components.cost numeric`.
- Объёмы: 46 позиций (6 удалено), 7 проектов, 3 организации, 4 членства, 12 операций-услуг. Бэкфилл при миграции не нужен — данных о платежах в системе нет.

### 1.3 Изученные файлы

**Живая схема БД (первоисточник):** `temp/introspect.sql`, `temp/introspect2.sql` → [research/01-catalog.json](.scratch/material-payments/research/01-catalog.json), [research/02-catalog-extra.json](.scratch/material-payments/research/02-catalog-extra.json), дайджест [research/01-schema-from-db.md](.scratch/material-payments/research/01-schema-from-db.md), снимок PostgREST [research/00-postgrest-schema-raw.txt](.scratch/material-payments/research/00-postgrest-schema-raw.txt). Схема снята через Management API, потому что базовые таблицы в репозитории не создаются ни одной миграцией.

**Ценообразование:** `lib/spec/pricing.ts`, `lib/constants.ts`, `lib/queries.ts`, `lib/spec/mappers.ts`, `lib/spec/public-spec.ts`, `lib/spec/project-budget.ts`, `lib/spec/pdf-document.tsx`, `app/share/spec/[token]/page.tsx`, `actions/spec-export.ts`, `lib/spec/history.ts`, `lib/spec/activity-format.ts`, `lib/validations.ts` — разбор в [research/02-pricing.md](.scratch/material-payments/research/02-pricing.md).

**Закупка и UI:** `components/spec-builder/modals/procure-modal.tsx`, `components/spec-builder/modals/spec-mat-detail-modal.tsx`, `components/spec-builder/modals/spec-components-section.tsx`, `components/spec-builder/layout/*`, `hooks/use-spec-builder.ts`, `lib/spec/status.ts`, `actions/specifications.ts`, `actions/spec-components.ts`, `actions/spec-item-files.ts`, `actions/spec-comments.ts`, `actions/service-operations.ts` — разбор в [research/03-procurement-ui.md](.scratch/material-payments/research/03-procurement-ui.md).

**Доступ и RLS:** `supabase/migrations/*` (все), `docs/adr/0001`, `GLOSSARY.md`, `lib/permissions.ts`, `lib/db/guard.ts`, `lib/auth/*`, `auth.config.ts`, `integration/spec-item-files.int.test.ts` — разбор в [research/04-access-rls.md](.scratch/material-payments/research/04-access-rls.md).

**Публичный канал:** `lib/spec/public-spec.ts`, `app/share/spec/[token]/page.tsx`, `lib/spec/pdf-document.tsx`, `actions/spec-export.ts`, `proxy.ts`, `components/spec-builder/summary/*` — разбор в [research/05-public-channel.md](.scratch/material-payments/research/05-public-channel.md).

**Путь данных для воронки:** `app/(protected)/[orgSlug]/projects/[id]/page.tsx`, `lib/queries.ts`, `lib/spec/project-budget.ts`, `components/spec-builder/summary/spec-summary.tsx`, `lib/supabase/database.overrides.ts` — разбор в [research/06-procure-data-path.md](.scratch/material-payments/research/06-procure-data-path.md).

### 1.4 Механизмы, которых в системе нет

| Ожидание из ТЗ | Факт |
| --- | --- |
| «Фиксация цены после заказа» | **Отсутствует.** `price`/`qty`/скидки правятся в любом статусе; `setSpecItemPrice` (`actions/specifications.ts:697-762`) статус не смотрит; «замок» `isLocked` (`lib/spec/status.ts:57-62`) гасит только поле марки |
| История цены как фиксация | Аудит `price_changed` (`lib/spec/history.ts:483-493`) пишет в то же изменяемое поле |
| Хранение итога/закупки позиции | В БД нет: `priceOf()` считает на лету, в представлении `spec_items_priced` есть только `qty_final` и `price_final` |
| Платежи, график, оплаты | Нет ни таблиц, ни типов, ни UI |

---

## 2. Существующие поля и механизмы, которые можно переиспользовать

| Механизм | Первоисточник | Как используется |
| --- | --- | --- |
| `spec_items.id` как якорь | `spec_item_files`, `spec_item_events` | `spec_item_payments.spec_item_id NOT NULL` + `RESTRICT` |
| Денормализация `org_id`/`project_id` с триггером | `spec_items_sync_org()` (живой триггер), `spec_item_files` | `payment_sync_scope()`/`payment_plan_sync_scope()`: `org_id`/`project_id` всегда из позиции — расхождение невозможно |
| `handle_updated_at()` | живая функция, триггер `set_spec_items_updated_at` | триггер `updated_at` для обеих новых таблиц |
| `numeric(12,2)` | `spec_items.price`, `materials.price` | суммы плана и факта |
| `deleted_at timestamptz` | `spec_item_files`, `spec_item_comments` | мягкое удаление ошибочной проводки и строки графика |
| `position integer` | `spec_item_components.position`, `spec_item_variants.position` | порядок строк графика |
| Снимки `*_snapshot` | `spec_items.company_name_snapshot`, `spec_item_events.actor_name_snapshot`, `project_services.supplier_snapshot` | `code_snapshot`, `name_snapshot`, `project_title_snapshot`, `author_name_snapshot` в факте |
| Журнал `spec_item_events` (payload jsonb, снимок имени актора) | `20260918_001`, `lib/spec/history.ts` | аудит платежей новыми `kind` |
| Расширение списка `kind` | `20260919_001`, `20260920_001`, `20260921_001` | снять и наложить заново `spec_item_events_kind_check` |
| `due_date date` по образцу `service_operations.deadline` | `20260907_001` | срок платежа (слово другое: `deadline` там — срок работы, здесь — срок платежа) |
| Форма RLS-предиката «членство + сверка `org_id` с позицией» | `spec_item_files`, `spec_item_comments` | все политики новых таблиц |
| Частичный unique-индекс | `spec_items_project_code_uidx ... where deleted_at is null and code is not null` | `(spec_item_id, position) where deleted_at is null`, идемпотентность |
| `security definer` RPC с `for update` | `set_spec_item_code`, `accept_invite`, `transfer_organization_ownership` | образец для транзакционной перестановки строк графика |
| Роли и `can()` | `organization_members.role`, `lib/permissions.ts` | проверки в actions |
| `createAdminClient()` | `lib/supabase/admin.ts:4` | путь записи из actions (RLS обходится — проверки обязательны в TS) |

Чего переиспользовать **нельзя**: `base_price`, `client_discount`, `supplier_discount`, `cutting_stock` — живые колонки `spec_items`, но приложение их не читает и не пишет (мёртвые; в истории исключены). Строить на них расчёт оплат нельзя.

---

## 3. Предлагаемая схема таблиц

Полный DDL — [migration-draft.sql](.scratch/material-payments/migration-draft.sql). Ниже — состав и обоснования.

### 3.1 `spec_item_payment_plans` — плановый платёж (строка графика)

| Колонка | Тип | Правила |
| --- | --- | --- |
| `id` | `uuid` | PK, `default gen_random_uuid()` (как в `spec_item_files`) |
| `org_id` | `uuid` | NOT NULL, FK → `organizations(id)` **ON DELETE RESTRICT**, заполняется триггером |
| `project_id` | `uuid` | NOT NULL, FK → `projects(id)` **ON DELETE RESTRICT**, заполняется триггером |
| `spec_item_id` | `uuid` | NOT NULL, FK → `spec_items(id)` **ON DELETE RESTRICT** |
| `title` | `text` | NOT NULL, CHECK непустой после `btrim` |
| `amount` | `numeric(12,2)` | NOT NULL, CHECK `> 0` |
| `condition` | `text` | «условие оплаты» свободным текстом; NULL или непустая строка |
| `due_date` | `date` | необязательный срок |
| `position` | `integer` | NOT NULL default 0, порядок отображения |
| `created_by` | `uuid` | FK → `users(id)` ON DELETE SET NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL `default now()`, `updated_at` — триггер `handle_updated_at()` |
| `deleted_at` | `timestamptz` | мягкое удаление |

Дополнительно: `UNIQUE (id, spec_item_id)` — цель составного FK из фактов; частичный `UNIQUE (spec_item_id, position) WHERE deleted_at IS NULL`; индексы `(spec_item_id) WHERE deleted_at IS NULL`, `(org_id)`, `(project_id)`.

### 3.2 `spec_item_payments` — фактическая оплата

Колонки: `id`, `org_id`, `project_id`, `spec_item_id` (все три FK — **RESTRICT**), `payment_plan_id uuid NULL`, `kind text NOT NULL DEFAULT 'payment'` c CHECK `in ('payment','refund')`, `amount numeric(12,2) NOT NULL CHECK (> 0)`, `paid_at date NOT NULL DEFAULT current_date`, `comment text`, `created_by uuid` (SET NULL), `author_name_snapshot`, `code_snapshot`, `name_snapshot`, `project_title_snapshot`, `idempotency_key uuid`, `created_at`, `updated_at`, `deleted_at`.

Реквизитов платежа (номер счёта или поручения, скан) здесь **нет намеренно**: документ — отдельная задача (O10), и колонка-заглушка её бы не заменила.

Ключевое ограничение:

```sql
constraint spec_item_payments_plan_same_item_fkey
  foreign key (payment_plan_id, spec_item_id)
  references public.spec_item_payment_plans (id, spec_item_id)
  on delete restrict
```

Оно закрывает сразу три требования ТЗ: **оплата привязывается только к плану своей позиции**, **платежи без плана разрешены** (при `payment_plan_id IS NULL` составной FK по `MATCH SIMPLE` не проверяется), и **защита работает при конкурентных запросах** — это ограничение БД, а не проверка в приложении, которую можно обойти гонкой.

Индексы: `(spec_item_id) WHERE deleted_at IS NULL`, `(payment_plan_id) WHERE deleted_at IS NULL`, `(project_id, paid_at)`, `(org_id)`, частичный `UNIQUE (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

### 3.3 Обоснования решений

- **`RESTRICT` вместо `CASCADE` у всех трёх FK.** Соседние таблицы каскадятся (`spec_item_files`, `spec_item_events`), но они — производные данные. Финансовая история каскадом не удаляется: физическое удаление позиции/проекта с платежами падает с ошибкой, обычный путь удаления — `deleted_at`. Это отклонение от соседей осознанное (ADR [0004](docs/adr/0004-finansovaya-istoriya-ne-udlyaetsya-kaskadom.md)).
- **`numeric(12,2)`, а не `numeric` без typmod.** В `service_operations.amount` точность не задана, поэтому там возможна сумма 1.005 ₽. Для платежей берём денежный тип с фиксированной шкалой; предел 10^10 ₽ принят по умолчанию (раздел 9.2, O7).
- **Снимки только в факте, не в плане.** План — живая строка графика, его ссылка на позицию защищена `RESTRICT`; снимок нужен там, где на него ссылается история и отчёты, то есть в факте.
- **`position` уникален в пределах позиции.** Перестановка строк требует обновить две строки в одной транзакции, иначе частичный индекс упадёт; прецедент — обмен кодами в `set_spec_item_code` (обновление обеих строк одним statement-ом с блокировкой проекта).
- **Никаких представлений над платежами.** Причина — риск R1.
- **Возврат — это вид платежа, а не знак суммы.** `kind` (`payment` | `refund`) при положительной сумме: возврат читается в истории явной строкой, CHECK `amount > 0` сохраняется, а «оплачено» остаётся понятной величиной, а не сальдо неизвестного происхождения. Альтернатива со отрицательными суммами отвергнута: знак легко прочитать неверно, а `paid` превращается в сальдо.
- **Ключ идемпотентности.** Повтор запроса (двойное нажатие, ретрай) не создаёт вторую оплату: action при `23505` по `spec_item_payments_idempotency_uidx` возвращает уже созданную запись.
- **DDL продуктовых правок не требует.** `spec_items` не меняется вообще (добавляется только расширение CHECK у `spec_item_events`, как в трёх предыдущих миграциях).

---

## 4. Проект RLS-политик

### 4.1 Существующая модель доступа (факты)

- Роли: `owner | admin | member | viewer` (enum `public.org_role`).
- Предикат членства — `public.is_org_member(uuid)`, `SECURITY DEFINER` (тело: `exists (select 1 from organization_members where org_id = _org_id and user_id = auth.uid())`).
- У `projects` четыре политики для роли `public` с `is_org_member(org_id)`.
- У `spec_items`, `materials`, `companies`, `contacts`, `spec_item_variants` RLS **включён, политик нет** — то есть по anon/authenticated токену они полностью закрыты.
- У `spec_item_files` и `spec_item_events` есть только SELECT-политика; запись идёт через service role.
- Ни в одной политике нет формы «через `projects.organization_id`»; форма — денормализованный `org_id` плюс сверка с `spec_items.org_id`.
- Записи `viewer` запрещены только точечно: комментарии (`m.role <> 'viewer'` на INSERT) и загрузка файлов; у компонентов и операций-услуг — только членство.

### 4.2 Проектируемые политики

Для обеих новых таблиц: RLS включён, `anon` — ничего, `authenticated` — по политикам.

| Таблица | Команда | Кто | Условие |
| --- | --- | --- | --- |
| `spec_item_payment_plans` | SELECT | любой член | членство + `s.org_id = plans.org_id` |
| | INSERT/UPDATE/DELETE | любой, кроме `viewer` | то же + `m.role <> 'viewer'` |
| `spec_item_payments` | SELECT | любой член | членство + `s.org_id = payments.org_id` |
| | INSERT | любой, кроме `viewer` | то же + `created_by = auth.uid()` (как у комментариев) |
| | UPDATE/DELETE | автор или `owner`/`admin` | `created_by = auth.uid()` **или** `m.role in ('owner','admin')`, плюс сверка организации |

Полные тексты — в [migration-draft.sql](.scratch/material-payments/migration-draft.sql), раздел 4.

### 4.3 Честная оговорка

Так как приложение всегда ходит service-role клиентом, эти политики **сегодня инертны** — ровно как существующие политики `projects` и `spec_item_files`. Они описывают модель доступа для будущих клиентских или серверных подключений с реальным JWT и служат документацией границ. Рабочая защита обязана быть в actions: `spec_item_payment_plans`/`spec_item_payments` не попадают под `assertCanMutate` (`lib/db/guard.ts` знает только `projects|materials|companies|contacts`), а у `spec_items` нет `created_by`, поэтому право на платёж выводится из **автора проекта** плюс роли в организации — как это уже сделано для записи позиций (`actions/specifications.ts:55-68`). Это надо реализовать явно, а не наследовать по аналогии.

---

## 5. Алгоритмы расчёта: оплачено, остаток, переплата

Все суммы считаются **в SQL** над `numeric` и только затем форматируются; складывать округлённые JS-значения нельзя (см. риск R5).

### 5.1 По позиции

```sql
select
  coalesce(p.planned, 0)                                    as planned,     -- Σ план
  coalesce(f.paid, 0)                                       as paid,        -- Σ оплат − Σ возвратов
  coalesce(f.refunded, 0)                                   as refunded,    -- Σ возвратов, справочно
  coalesce(p.planned, 0) - coalesce(f.paid, 0)              as remaining,   -- > 0 осталось, < 0 переплата
  greatest(coalesce(f.paid, 0) - coalesce(p.planned, 0), 0) as overpaid,    -- только при непустом графике
  coalesce(f.unplanned, 0)                                  as unplanned    -- оплаты без плана
from (
  select sum(amount) as planned
    from spec_item_payment_plans
   where spec_item_id = $1 and deleted_at is null
) p
full join (
  select
    coalesce(sum(amount) filter (where kind = 'payment'), 0)
      - coalesce(sum(amount) filter (where kind = 'refund'), 0)  as paid,
    coalesce(sum(amount) filter (where kind = 'refund'), 0)      as refunded,
    coalesce(sum(amount) filter (where kind = 'payment' and payment_plan_id is null), 0)
      - coalesce(sum(amount) filter (where kind = 'refund' and payment_plan_id is null), 0)
                                                                 as unplanned
    from spec_item_payments
   where spec_item_id = $1 and deleted_at is null
) f on true;
```

Правила:

1. **Плановый платёж не является оплатой.** `planned` и `paid` — разные величины, они не вычитаются при записи и не подменяют друг друга. Оплаченным считается только факт.
2. **Частичные оплаты.** Несколько фактов могут ссылаться на одну строку графика: `plan_paid = Σ фактов с этим payment_plan_id`, `plan_remaining = plan.amount − plan_paid` (может быть отрицательным).
3. **Возврат уменьшает оплаченное и виден отдельно.** `kind = 'refund'` входит в `paid` со знаком минус, но `refunded` показывается собственной строкой — иначе уменьшение оплаты выглядит как правка истории. Возврат больше, чем оплачено, БД не запрещает: интерфейс показывает это явной пометкой (причина не обязательна, решение Q13).
4. **Платежи без плана разрешены** и считаются в `paid`, но не в `plan_paid`; отдельная величина `unplanned` показывает, сколько денег вне графика.
5. **Переплата допускается и показывается явно.** Правило границы: если график пуст (`planned = 0`), то `paid` — это «оплачено вне графика», а не 100% переплата; `overpaid` показывается только при непустом графике.
6. **Мягко удалённые строки исключаются** из обеих сумм (`deleted_at is null`), но остаются в журнале событий.
7. **Стоимость позиции рядом — справка, не база остатка** (решение Q1): `cost = priceOf(item).total` показывается для контекста, остаток от неё не считается.

### 5.2 По проекту и организации

Проектный уровень: те же суммы, агрегированные по `project_id` (индекс `(project_id, paid_at)` поддержан), плюс разрез по услугам проекта — но у услуг своя модель (одна сумма на операцию, ADR [0001](docs/adr/0001-usluga-schitaetsya-odnokratno-na-proekt.md)), поэтому их оплаты — отдельный этап (O2).

### 5.3 Округление

`numeric(12,2)` в БД и `round2` при показе. Ошибка складывания уже существует в проекте: `sumItems` (`lib/spec/pricing.ts:66-68`) округляет накопитель, а публичная страница и PDF складывают сырые `priceOf().total` — на семи позициях с построчным итогом 0.34 это даёт 2.38 против 2.3471 ([research/02](.scratch/material-payments/research/02-pricing.md), §7.2). Для платежей агрегат считается один раз в SQL, поэтому такого расхождения не возникает.

---

## 6. Влияние фиксации цены и изменения стоимости на график

1. **Фиксации цены в системе нет** (раздел 1.4). Поэтому модель платежей принципиально не выводит обязательство из стоимости: суммы плана хранятся, суммы фактов хранятся, остаток считается между ними (Q1, ADR [0003](docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md)).
2. **Изменение цены, количества, скидок или запаса не трогает ни график, ни оплаты.** Технически связать их нечем: между стоимостью и платежами нет ни FK, ни триггера, ни вычисляемой колонки. Правило «изменение стоимости не переписывает историю оплат и автоматически не меняет сохранённые суммы плана» выполняется по построению, а не дисциплиной разработчика.
3. **Изменение статуса позиции** (`approved → ordered → delivered`) на платежи не влияет: статусная модель не трогается (ограничение ТЗ), платежи не привязаны к статусам и не блокируются ими.
4. **Изменение графика после появления оплат** разрешено (сумма строки — обязательство, а не производная), но: правка суммы/условия/срока пишет событие `payment_plan_changed` с payload; **мягкое удаление строки, по которой есть неудалённые факты, запрещено** (Q9) — сначала надо отвязать или удалить оплаты, и каждое действие видно в журнале. Оплаты при этом не теряются никогда: связь `payment_plan_id` защищена составным FK с `RESTRICT`.
5. **Стоимость рядом со графиком — справочная.** Если её показывать, надо назвать источник: `priceOf()` (JS, `INTEGER_UNITS = весь UNIT_OPTIONS`, `lib/spec/pricing.ts:4`) и `spec_items_priced.qty_final` (SQL, шесть захардкоженных единиц) дают разные результаты при расхождении списка единиц — см. риск R6.
6. **Бэкфилл не нужен**: таблиц платежей нет, в системе нет ни одной оплаты. Если оплаты ведутся вне системы, импорт — отдельная задача (O3).
7. **Если понадобится устойчивый остаток «от стоимости»**, это отдельное решение с отдельной миграцией (снимок суммы заказа в `spec_items`), которое выходит за рамки «только платежи»; в этом этапе сознательно не делается.

---

## 7. Предлагаемые изменения ProcureModal и карточки материала

Решение Q5: **ведение платежей — во вкладке «Платежи» карточки материала**; в `ProcureModal` изменений нет (Q12 — сводка отложена).

### 7.1 Вкладка «Платежи»

- Точка входа — `components/spec-builder/modals/spec-mat-detail-modal.tsx` (список вкладок, `:286-295`) плюс контракт `?tab=`, по которому уже живут Файлы и Комментарии.
- Устройство вкладки — по образцу `files-tab.tsx` и `activity-tab.tsx`: собственный запрос данных в локальное состояние, собственные actions, собственный рендер — а не чтение из `ctx.items` ([research/03](.scratch/material-payments/research/03-procurement-ui.md), §8).
- Состав:
  1. сводка: **План · Оплачено · Возвраты · Остаток · Переплата · Вне графика** (переплата и возвраты — отдельными явными строками, как требует ТЗ и решение O1);
  2. таблица графика: название, сумма, условие, срок, порядок (перестановка), покрытие по строке (`оплачено / осталось`), действия;
  3. список фактов: вид (оплата или возврат), дата, сумма, привязка к строке графика (или «без плана»), комментарий, автор со снимком имени, отмена (мягкое удаление);
  4. форма: вид (оплата/возврат), сумма, дата, необязательная строка графика, комментарий; ключ идемпотентности генерируется на открытие формы.
- Рядом со сводкой — стоимость позиции как справка с подписью источника (пункт 6.5), а сроки — с той же пометкой просрочки, что у услуг (решение O6, прецедент `lib/spec/service-operation-deadline.ts`).

### 7.2 Почему это дешевле, чем кажется

Платежи **не меняют `spec_items`**, поэтому не требуется синхронизировать состояние конструктора: `items` в `use-spec-builder.ts:218` — это `useState(initialItems)` без синхронизации с пропсами, и `revalidatePath` из actions до открытого конструктора не доходит вовсе. Для вкладки это плюс: достаточно локального рефетча, как у файлов и комментариев; полагаться на `revalidatePath` в этом экране нельзя.

### 7.3 ProcureModal: строка «оплачено / остаток»

Решение Q17 — строку добавляем. Механизм выбран по [research/06](.scratch/material-payments/research/06-procure-data-path.md): **отдельное серверное действие-читалка**, которое модалка вызывает в `useEffect` при открытии; образец — `SpecSummary`, который так же догружает составы (`spec-summary.tsx:63-85`). Правки ограничиваются новым action и `procure-modal.tsx`.

Почему не проброс пропсом со страницы, хотя технически он возможен (`page.tsx` → `SpecBuilder` → модалка): открытие идёт по URL `?dialog=procure` (`project-actions.tsx:49-57` → `spec-builder.tsx:186-193` → `openProcure`), и хотя серверный рендер страницы при этом свежий, программный `ctx.openProcure()` рендера не вызывает — проп остался бы от прошлого рендера. Fetch-on-open этой ловушки не имеет и не требует синхронизации конструктора после записи платежа.

Содержимое строки: **план · оплачено · остаток · переплата** по тем же позициям, что и «Сумма в закупке» (`scopeSum`: `approved`/`ordered`/`delivered` без заглушек, `hooks/use-spec-builder.ts:1486-1532`), плюс отдельная пометка, если оплаты есть у позиций вне этой области. Ввода платежей в модалке нет.

### 7.4 Публичный канал: что уже есть

Факты из [research/05](.scratch/material-payments/research/05-public-channel.md):

- Публичный доступ — capability-токен: строка в `public_links` и две точки входа (`/share/spec/<token>`, `/api/spec-pdf/<token>`), вне auth-middleware, чтение идёт **service-role** клиентом (`lib/spec/public-spec.ts:50`). RLS здесь не защита: выборку платежей придётся ограничивать по `project_id` **и** `org_id` ссылки (образец — `public-spec.ts:78-79`, `:209-210`).
- Ссылка выпускается ровно в одном месте — `generatePublicLink` (`actions/spec-export.ts:239-266`), кнопка PDF делегирует туда же. Срок жизни жёстко 7 дней, отзыва и владельца у ссылки нет, cron-очистки нет.
- `client_view` — **не** «показывать ли раздел», а вариант вёрстки: читается в одном месте (`public-spec.ts:265`) и меняет подписи и бейджи (содержательно — только в Excel). Переиспользовать его под платежи значит смешать две разные вещи.
- Закупочную цену, маржу и заметки скрывает не флаг, а сама публичная модель (`supplierDiscountPct: 0`, `notes: ""`, `public-spec.ts:117,131`). Значит, при публичном показе оплат так же отбираются `comment`, `created_by` и `author_name_snapshot`.
- Файлов и картинок публично нет вовсе: бакет `spec-item-files` приватный, выдача — только подписанный URL на 5 минут из защищённой вкладки. Для документов платежа этого не хватит (риск R13).
- Механизм «секция, если есть данные» (`byType.filter(count > 0)`, `app/share/spec/[token]/page.tsx:47`) — готовый шаблон для опционального блока.

### 7.5 Что не делаем

- **Платежи не идут в проектную сводку, Excel и PDF**: решение Q17 — только строка в воронке (внутренние деньги не расширяют экспорт, где уже два рецепта одной цифры, риск R5).
- **Публичная спецификация в этом этапе не меняется**: переключатель и состав блока решены (Q20, Q21) и записаны в разделе 8.5, но отдельного тикета у них пока нет — они ждут задачи про документ, потому что сценарий «клиент платит сам» без счетов и договоров бессмысленен.
- **Никаких представлений над платежами** (риск R1).

---

## 8. Что нужно сделать: миграции, типы, actions, тесты

### 8.1 Миграции

Один файл `supabase/migrations/<date>_001_add_spec_item_payments.sql` (черновик готов):

1. функции `payment_plan_sync_scope()` и `payment_sync_scope()`;
2. `create table spec_item_payment_plans` + ограничения, индексы, триггеры;
3. `create table spec_item_payments` + ограничения (включая составной FK и вид платежа `kind`), индексы, триггеры;
4. снятие и наложение `spec_item_events_kind_check` с шестью новыми `kind`: `payment_plan_added|payment_plan_changed|payment_plan_removed|payment_added|payment_changed|payment_removed` (прецедент — три миграции 20260919–20260921);
5. RLS: 4 политики на график, 4 на факты, `grant` для `authenticated`, `revoke` для `anon`.

Продуктовые таблицы не меняются; данные не бэкфиллятся.

### 8.2 Типы и доменные модули

- Регенерация `lib/supabase/database.types.ts` (файл генерируется из БД) и добавления в `lib/types.ts`.
- `lib/spec/payment-schedule.ts` — **чистый расчёт**: `planned/paid/remaining/overpaid/unplanned`, покрытие по строкам графика, исключение удалённых. Это высший шов для тестов: без React, без БД.
- `lib/spec/history.ts` — новые `kind` в `SPEC_ITEM_EVENT_KINDS`; `lib/spec/activity-format.ts` — тексты событий (`payment_added` и т.д.). Прецедент — тексты `service_added`/`price_changed`.

### 8.3 Серверные actions

`actions/spec-item-payments.ts` (структура — по образцу `actions/spec-item-files.ts`):

- `createPaymentPlan` / `updatePaymentPlan` / `deletePaymentPlan` (перед удалением — проверка «нет неудалённых фактов», Q9);
- `recordPayment` (вид: оплата или возврат; ключ идемпотентности, обработка `23505`) / `updatePayment` / `deletePayment` (мягкое удаление);
- `movePaymentPlanPosition` — перестановка в одной транзакции (образец — `set_spec_item_code`);
- `getProjectPaymentsSummary` — **читалка** для строки в ProcureModal (план / оплачено / остаток / переплата по проекту), вызывается при открытии модалки (раздел 7.3);
- запись событий в `spec_item_events` при каждом действии (Q10);
- проверки прав в TS: членство, роль ≠ `viewer`, для чужой правки — `owner`/`admin`, вывод права из автора проекта (пункт 4.3).

### 8.4 Тесты

| Уровень | Файл | Что проверяет | Прецедент |
| --- | --- | --- | --- |
| unit | `lib/spec/payment-schedule.test.ts` | частичные оплаты, переплата, возвраты (в том числе возврат больше оплат), оплаты без плана, удалённые строки, пустой график, округление на многих строках | юнит-тестов на `pricing.ts` пока нет — это первый |
| unit | тесты форматирования событий | тексты новых `kind` | `lib/spec/activity-format.test.ts` |
| integration | `integration/spec-item-payments.int.test.ts` | `RESTRICT` не даёт удалить позицию; составной FK не даёт привязать план чужой позиции; уникальность `(spec_item_id, position)`; идемпотентность; RLS-политики | `integration/spec-item-files.int.test.ts` |
| action | `actions/spec-item-payments.test.ts` | права (viewer, чужой платёж), запрет удаления плана с фактами, запись журнала | `actions/spec-item-files.test.ts` |

Отдельно стоит зафиксировать тестом **отсутствие влияния** цены и количества на сохранённые суммы плана и фактов (пункт 6.2) — это главное правило этапа.

### 8.5 Следом за этапом, но уже в очереди

- **Документы платежа** (O10, решение Q19): счёт, платёжное поручение, чек, договор как отдельная сущность с типом, номером, датой и файлом. Готовый прецедент хранения файлов — `spec_item_files` (категории `document | texture | other`, приватный бакет, путь `<orgId>/spec-items/<itemId>/<uuid>`); публичная отдача таких файлов потребует отдельного решения (риск R13).
- **Опциональный публичный показ оплат** (O4, решения Q16, Q20, Q21): показ включается настройкой **проекта** (`payments_visible_to_client boolean NOT NULL DEFAULT false`) — сценарий «кто платит» это свойство проекта, и так переключатель переживает перевыпуск ссылки, которая живёт 7 дней. Когда он включён, клиент видит **план и факт**: суммы, даты, сроки и просрочку; `comment`, `created_by` и `author_name_snapshot` отбираются так же, как сейчас отбираются скидка поставщика и заметки. Выборка обязана ограничиваться по `project_id` **и** `org_id` ссылки: публичное чтение идёт service-role клиентом, и RLS здесь не защита.

### 8.6 Тикеты

Разбивка на четыре вертикальных среза (детали и критерии приёмки — в файлах тикетов):

| # | Тикет | Зависит от |
| --- | --- | --- |
| [01](.scratch/material-payments/issues/01-grafik-platezhey.md) | График платежей по позиции | — |
| [02](.scratch/material-payments/issues/02-fakticheskie-oplaty.md) | Фактические оплаты и остаток | 01 |
| [03](.scratch/material-payments/issues/03-vozvraty.md) | Возвраты | 02 |
| [04](.scratch/material-payments/issues/04-oplaty-v-voronke.md) | Строка оплат в воронке закупки | 02, 03 |

Документы платежа и публичный показ тикетов пока не получили: оба зависят от сущности документа (O11).

**Позже добавленные срезы** (файлы тикетов, не входившие в исходную разбивку):

| # | Тикет | Зависит от |
| --- | --- | --- |
| [05](.scratch/material-payments/issues/05-oplaty-ot-stoimosti.md) | Оплаты от стоимости позиции, график скрыт | 01–04 |
| [06](.scratch/material-payments/issues/06-vid-zapisi-i-dokumenty.md) | Вид записи в «Дополнительно» и документы к оплате | 05 |

Тикет 06 заодно переработал вкладку «Файлы» по отдельному макету: загрузка без диалога (вид документа угадывает сервер), группы документов с фильтр-чипами, строка с превью и действиями (переименование, скачивание, смена вида). Подробности — в самом тикете.

---

## 9. Риски и открытые вопросы

### 9.1 Риски

| # | Риск | Доказательство | Что делать |
| --- | --- | --- | --- |
| R1 | Представление `spec_items_priced` отдаёт данные `anon`: 40 не удалённых позиций с ценами | живой запрос с anon-ключом; view принадлежит `postgres` и обходит RLS базовой таблицы | починить отдельно: `security_invoker = true` или `revoke`; **над платежами представлений не создавать** |
| R2 | `public_links` без RLS: `anon` читает все 15 токенов публичных ссылок, а отзыва и владельца у ссылки нет | живой запрос; в таблице нет `enable row level security`; [research/05](.scratch/material-payments/research/05-public-channel.md) | отдельная задача безопасности: включить RLS и не полагаться на секретность токена |
| R3 | RLS инертна в проде (`auth.uid()` = NULL, всюду service role) → защита держится на TS-проверках | `lib/supabase/admin.ts:4`; политики `projects`/`spec_item_files` в том же состоянии | явные проверки прав в actions; тест на отказ |
| R4 | `deleteProject` удаляет проект физически, а дети каскадятся: с платежами удаление начнёт падать | `actions/projects.ts:109-113`; FK-граф из каталога | понятная ошибка вместо тихой потери; штатный путь — `deleted_at`; прецедент обработки — `ref_spec_item_id` RESTRICT |
| R5 | Расхождение денежных сумм: `sumItems` округляет накопитель, публичная страница и PDF складывают сырые значения (2.38 против 2.3471) | `lib/spec/pricing.ts:66-68`; `app/share/spec/[token]/page.tsx:25,31,45` | агрегаты платежей считать один раз в SQL |
| R6 | Две формулы стоимости: `priceOf()` (все единицы из `UNIT_OPTIONS`) и `spec_items_priced.qty_final` (шесть единиц) | `lib/spec/pricing.ts:4`; тело представления в `01-schema-from-db.md` | назвать источник, если стоимость показывается рядом с графиком |
| R7 | Масштаб `stock_pct` в форматтере истории трактуется как доля (100×), тогда как расчёт и данные — проценты (max 10) | `lib/spec/activity-format.ts:284`; живые данные `min 0, max 10` | починить отдельно; рядом с деньгами это видно |
| R8 | `organizations` каскадит во всё; наши `RESTRICT` — отклонение от соседей | FK-граф: `spec_items.org_id → organizations ON DELETE CASCADE` | осознанное отклонение, ADR [0004](docs/adr/0004-finansovaya-istoriya-ne-udlyaetsya-kaskadom.md); ждать ошибку FK при попытке удалить организацию |
| R9 | Мёртвые денежные колонки `base_price`, `client_discount`, `supplier_discount`, `cutting_stock` (NOT NULL, никем не читаются) | [research/02](.scratch/material-payments/research/02-pricing.md) | не строить на них расчёт оплат |
| R10 | Валюты в схеме нет нигде; история пишет `RUB` строкой | каталог: ни одной `currency` | зафиксировано в ADR [0003](docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md) |
| R11 | Два дублирующих триггер-хелпера `updated_at` (`handle_updated_at`, `touch_updated_at`) | живой список триггеров | переиспользуем `handle_updated_at` |
| R12 | `service_operations.amount numeric` без typmod — деньги без заданной шкалы | каталог: `numeric_precision = null` | новый код берёт `numeric(12,2)`; старую колонку не трогаем |
| R13 | Документы платежа нечем отдать клиенту: бакет `spec-item-files` приватный, политики `storage.objects` пускают только `authenticated` с членством в организации, а картинки и файлы в публичную страницу и PDF не попадают вовсе | каталог политик; `public-spec.ts:72-76,130,136`; [research/05](.scratch/material-payments/research/05-public-channel.md) | отдельная задача: подписанная ссылка при рендере, прокси-роут `/api/spec-file/<token>/<fileId>` или отдельный публичный бакет; последнее — наименее желательное |

### 9.2 Открытые вопросы

**Закрыты в круге 3** (см. [Приложение А](#приложение-а-решения-интервью)): возвраты — вид платежа `kind` ([O1](#9-риски-и-открытые-вопросы)/Q13); услуги и проектные платежи — следующий этап (O2/Q14); импорт не нужен (O3/Q15); срок и просрочка показываются (O6/Q18); реквизиты — отдельная задача про документ (O10/Q19); строка «оплачено / остаток» в ProcureModal добавляется (O5/Q17).

**Закрыты в круге 4:** публичный показ — настройка проекта `payments_visible_to_client` (Q20); состав публичного блока — план и факт без комментариев, авторов и служебных полей (Q21); разбивка на четыре тикета утверждена, тикет воронки ждёт и возвратов (раздел 8.6).

**Остаются открытыми:**

- **O11. Документы платежа.** Объём сущности (тип, номер, дата, файл, связь с оплатой), место хранения файла и способ отдачи клиенту. Отдельная задача (Q19), но именно она определяет, что попадёт в публичный блок сценария «клиент платит сам».
- **O12. Обратная сторона переключателя.** Когда показ выключен (сценарий генподряда), публичная спецификация остаётся прежней — без раздела «Оплата» и без намёка на график. Подтверждено по умолчанию.

**Принято по умолчанию, скажите, если не так:**

- **O7. Предел суммы.** Остаётся `numeric(12,2)` — до 10 000 000 000 ₽.
- **O8. Политика идемпотентности.** Ключ генерирует клиент при открытии формы; область уникальности — организация; срок жизни не ограничен; повтор с тем же телом возвращает уже созданную запись, с другим телом — ошибку.
- **O9. Чтение для `viewer`.** `viewer` читает платежи, но не пишет (суммы оплат видны всем членам организации, включая наблюдателей).

---

## Приложение А. Решения интервью

| # | Вопрос | Решение |
| --- | --- | --- |
| Q1 | База для остатка | Остаток считается **внутри графика** (Σ план − Σ факт); стоимость позиции — справка, фиксация заказа не вводится |
| Q2 | Удаление материала с платежами | FK `RESTRICT` + снимки кода/имени позиции и названия проекта в факте; штатный путь — `deleted_at` |
| Q3 | Кто вправе вносить | Любой член, кроме `viewer`; чужую оплату правит автор или `owner`/`admin`; читают все члены |
| Q4 | Гранулярность | Только позиция (`spec_item_id`), `org_id`/`project_id` — денормализация через триггер |
| Q5 | Где ведём | **Отдельная вкладка «Платежи»** в карточке материала; в ProcureModal ввода нет |
| Q6 | Условие и валюта | Условие — свободный текст, `due_date` — `date`; колонки валюты нет (рубли) |
| Q7 | Защита от гонок | Ограничения БД + ключ идемпотентности; многострочные операции — транзакцией |
| Q8 | Удаление факта | Мягкое удаление + событие в журнале |
| Q9 | План с фактами | Удаление запрещено, пока есть неудалённые факты |
| Q10 | Аудит | В существующий `spec_item_events` новыми `kind` |
| Q11 | Переплата | Показывается явно, причина не обязательна |
| Q12 | Сводка в ProcureModal | Отложена на тот момент; закрыта в круге 3 (Q17) |
| Q13 | Возвраты (O1) | Вид платежа `kind`: `payment` \| `refund` при положительной сумме; возврат виден отдельной строкой и уменьшает оплаченное |
| Q14 | Область этапа (O2) | Только позиции; услуги и проектные предоплаты — следующий этап, отдельной таблицей |
| Q15 | Импорт оплат (O3) | Оплаты вне системы не ведутся — импорт не нужен |
| Q16 | Публичный канал (O4) | Показ клиенту **опциональный**: генподряд — всё внутреннее; клиент платит сам — ему нужны таблица оплат и документы (счета, чеки, договоры) |
| Q17 | Сводка (O5) | Добавить read-only строку «оплачено / остаток» в ProcureModal; в проектную сводку и экспорт — нет |
| Q18 | Срок платежа (O6) | Показывать срок и просрочку тем же правилом, что у услуг; напоминаний нет |
| Q19 | Реквизиты платежа (O10) | Отдельная задача про документ (тип, номер, дата, скан); колонок под них в этой миграции нет |
| Q20 | Где живёт переключатель публичного показа (O4a) | Настройка **проекта** `payments_visible_to_client` (default false): сценарий «кто платит» — свойство проекта, и переключатель переживает перевыпуск ссылки |
| Q21 | Состав публичного блока (O4b) | План и факт: суммы, даты, сроки и просрочка; комментарии, авторы и служебные поля отбираются |

## Приложение Б. Что появилось в документации

- [GLOSSARY.md](GLOSSARY.md) — раздел «Платежи»: плановый платёж, фактическая оплата, график платежей, остаток по графику, переплата, оплата вне графика.
- ADR [0003](docs/adr/0003-grafik-platezhey-eto-samostoyatelnyy-fakt.md) — график платежей самостоятелен по отношению к стоимости позиции (следствие: цены меняются, суммы плана и истории — нет; деньги только в рублях).
- ADR [0004](docs/adr/0004-finansovaya-istoriya-ne-udlyaetsya-kaskadom.md) — финансовая история не удаляется каскадом: `RESTRICT`, снимки, мягкое удаление.
