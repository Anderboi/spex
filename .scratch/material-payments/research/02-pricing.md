# Ценообразование позиции спецификации и фиксация цены

Этап 1, исследование под модель платежей по материалам. Все утверждения — со ссылкой
`путь:строка`. Типы из `lib/supabase/database.types.ts` (сгенерированы из БД) помечены как
«только по сгенерированным типам», но по деньгам они дополнительно сверены с живым дампом
PostgREST, уже лежащим в репозитории: `.scratch/material-payments/research/00-postgrest-schema-raw.txt`.

## Резюме

1. Вся цена позиции вычисляется **на лету, в JS**: `priceOf()` (`lib/spec/pricing.ts:31`) —
   единственная формула; в БД не хранится ни итог, ни закупка, ни маржа.
2. Входы `priceOf` — **сырая строка `spec_items`**, а не представление `spec_items_priced`:
   приложение вообще ни разу не запрашивает это представление (совпадения только в
   сгенерированных типах).
3. Формула: `qtyFinal = ceil(qty*(1+stock/100))` для «штучных» единиц иначе `round2`;
   `priceFinal = round2(price*(1−clientDiscountPct/100))`;
   `purchaseTotal = round2(qtyFinal*round2(price*(1−supplierDiscountPct/100)))`;
   `total = round2(qtyFinal*priceFinal)`; `margin = total − purchaseTotal`.
4. **Фиксации цены нет.** Нет ни полей `ordered_price`/`price_snapshot`/`purchase_price`,
   ни блокировок на сервере: `setSpecItemPrice` (`actions/specifications.ts:697`) и
   `saveSpecItemPatch` (`:101`) не смотрят на статус. Единственный «замок» — UI-хелпер
   `isLocked` (`lib/spec/status.ts:57`), и он влияет только на поле марки и текст
   подтверждения удаления.
5. История изменений цены есть (`price_changed` с `currency: "RUB"`), но это аудит, а не
   фиксация: последняя правка всегда переписывает то же поле `spec_items.price`.
6. Количество меняют `incQty`/`setQty` (`hooks/use-spec-builder.ts:518`, `:533`) — они лишь
   округляют qty до 2 знаков; запас и округление по единице в хранимое qty не попадают,
   только в расчёт.
7. Деньги в БД — `numeric` **без precision/scale**, не целые копейки; в JS всё округляется
   `round2` до копеек (перечень ниже), что и создаёт риск накопления расхождения.
8. `sumItems()` округляет накопитель на каждом шаге, а `app/share/spec/[token]/page.tsx:25`
   и `lib/spec/pdf-document.tsx:233` суммируют «сырые» `priceOf().total` — **формулы
   расходятся** (пример в §7.3).
9. Закупка (`supplierDiscountPct`) в клиентские артефакты не попадает: в публичной модели
   жёстко `supplierDiscountPct: 0` (`lib/spec/public-spec.ts:117`), в экспорт — только
   `priceFinal`/`total` (`actions/spec-export.ts:39`).
10. Запас трактуется как **процент** (`stock/100`, `lib/spec/pricing.ts:37`), а форматтер
    истории считает `stock_pct` **долей единицы** (`lib/spec/activity-format.ts:284`,
    тест `lib/spec/activity-format.test.ts:499`) — расхождение масштаба 100×, требует
    проверки в БД.

## 1. `priceOf()` и `sumItems()`: формула и входы

### 1.1 Формула (`lib/spec/pricing.ts`)

| Величина | Строка | Правило |
|---|---|---|
| `qtyBase` | `lib/spec/pricing.ts:36` | `Number(i.qty) \|\| 0` — плановая потребность |
| запас | `lib/spec/pricing.ts:37` | `raw = qtyBase * (1 + stock/100)` |
| `qtyFinal` | `lib/spec/pricing.ts:38` | если `unit` ∈ `INTEGER_UNITS` → `Math.ceil(raw)`, иначе `round2(raw)` |
| `INTEGER_UNITS` | `lib/spec/pricing.ts:4` | **все** значения `UNIT_OPTIONS` (`lib/constants.ts:116`), т.е. дробное количество не поддерживает ни одна единица из списка |
| `priceFinal` | `lib/spec/pricing.ts:41` | `round2(priceBase * (1 − cd/100))` |
| закупка за ед. | `lib/spec/pricing.ts:42` | `round2(priceBase * (1 − sd/100))` |
| `total` | `lib/spec/pricing.ts:44` | `round2(qtyFinal * priceFinal)` |
| `purchaseTotal` | `lib/spec/pricing.ts:45` | `round2(qtyFinal * purchase)` |
| `stockQty` | `lib/spec/pricing.ts:50` | `round2(qtyFinal − qtyBase)` |
| `discountAmount` | `lib/spec/pricing.ts:53` | `round2(qtyFinal * (priceBase − priceFinal))` |
| `margin` | `lib/spec/pricing.ts:56` | `round2(total − purchaseTotal)` |
| `hasQtyMod` / `hasPriceMod` | `lib/spec/pricing.ts:57-58` | `stock > 0` / `cd > 0` |

`priceBase` — это `spec_items.price` без скидок; так же описана колонка в живой БД:
`price: numeric, NOT NULL, // Базовая цена за единицу до скидок`
(`.scratch/material-payments/research/00-postgrest-schema-raw.txt:255`), и `qty` там же
трактуется как «Плановая потребность без запаса. Закупочное количество = qty * (1 +
stock_pct/100)» (`.scratch/material-payments/research/00-postgrest-schema-raw.txt:253`) —
комментарий совпадает с формулой `pricing.ts:37`.

`sumItems()` (`lib/spec/pricing.ts:62`) — `reduce` по `priceOf`, округляющий **накопитель**
после каждого элемента (`:66-68`), т.е. итог = сумма уже округлённых построчных итогов.

`round2` — `Math.round((n + Number.EPSILON) * 100) / 100` (`lib/spec/pricing.ts:6`).

### 1.2 Откуда берутся входы

Все поля — плоские колонки `spec_items`, прочитанные запросом `select('*')`:
`lib/queries.ts:626-637` (таблица `spec_items`, не представление), далее `rowToItem`
(`lib/spec/mappers.ts:21`) переводит их в `SpecItem`:
`qty: Number(r.qty)` (`lib/spec/mappers.ts:42`), `price: Number(r.price)` (`:44`),
`stockPct: Number(r.stock_pct ?? 0)` (`:56`), `clientDiscountPct: Number(r.client_discount_pct ?? 0)`
(`:57`), `supplierDiscountPct: Number(r.supplier_discount_pct ?? 0)` (`:58`).
Поля модели — `lib/types.ts:192-197`.

Публичная модель читает те же колонки явным списком `qty, ..., price, stock_pct,
client_discount_pct` (`lib/spec/public-spec.ts:73-74`) и собирает `SpecItem` вручную
(`:112-117`), принудительно зануляя закупочную скидку (`:117`).

### 1.3 Все вызовы `priceOf` / `sumItems` (grep по репозиторию, без node_modules/.next)

| Место | Что подаётся |
|---|---|
| `actions/spec-export.ts:29` | `SpecItem` из `getProjectSpecItems` (`:103`) |
| `actions/spec-export.ts:157` (`sumItems`) | те же позиции без заглушек (`:104`) |
| `app/share/spec/[token]/page.tsx:25,31,45` | публичная модель (`items` из `loadPublicSpec`) |
| `components/spec-builder/qty-price-block.tsx:16` | `SpecItem` из модели билдера |
| `components/spec-builder/summary/summary-item-row.tsx:17` | `SpecItem` |
| `components/spec-builder/spec-row.tsx:76` | `SpecItem` |
| `components/spec-builder/spec-list-row.tsx:39` | `SpecItem` |
| `components/spec-builder/spec-compact-card.tsx:50` | `SpecItem` |
| `components/spec-builder/spec-card.tsx:35` | `SpecItem` |
| `components/spec-builder/summary/spec-summary.tsx:100,117` | `ctx.items` (модель) |
| `hooks/use-spec-builder.ts:1475,1488,1493,1526` (`sumItems`) | `items` модели билдера |
| `components/spec-builder/modals/procure-modal.tsx:134,190` | `SpecItem` |
| `components/spec-builder/modals/manual-item-form.tsx:138` | **литерал формы** (qty/unit/price/три процента из react-hook-form), не строка БД |
| `components/spec-builder/modals/tabs/overview-tab.tsx:492` | дочерняя позиция `child` |
| `lib/spec/pdf-document.tsx:233,243,283` | публичная модель |

**Вывод:** `spec_items_priced` не используется ни в одном вызове. В коде приложения нет ни
одного запроса к этому представлению (поиск `spec_items_priced` даёт только
`lib/supabase/database.types.ts:472,696,870,967,981,1043,1117,1226,1398,1471` — это
описание FK-связи «на представление» в сгенерированных типах). Колонки
`qty_final`/`price_final` живого представления
(`.scratch/material-payments/research/00-postgrest-schema-raw.txt:323-324`) дублируют
`priceOf`, но приложением не читаются и не пишутся.

## 2. Поля стоимости, количества, скидок, запаса, валюты

`spec_items` — по живому дампу
(`.scratch/material-payments/research/00-postgrest-schema-raw.txt:245-285`), подтверждено
также `lib/supabase/database.types.ts:1231-1273` и `lib/spec/mappers.ts:42-58`:

| Колонка | Тип (живой дамп) | Смысл / подтверждение |
|---|---|---|
| `price` | `numeric NOT NULL` | базовая цена за ед. до скидок; дамп `:255`, используется `mappers.ts:44` |
| `qty` | `numeric NOT NULL` | плановая потребность без запаса; дамп `:253`, `mappers.ts:42` |
| `unit` | `text NOT NULL` | единица; влияет на округление `pricing.ts:38`, `constants.ts:116` |
| `stock_pct` | `numeric NOT NULL` | запас в %; `mappers.ts:56`, читается `pricing.ts:32,37` |
| `client_discount_pct` | `numeric NOT NULL` | скидка заказчику, целые проценты; `pricing.ts:33,41`, комментарий `activity-format.ts:273-277` |
| `supplier_discount_pct` | `numeric NOT NULL` | закупочная («студийная») скидка; `pricing.ts:34,42`, UI `manual-item-form.tsx:464-467` |
| `base_price` | `numeric NOT NULL` | **нигде в коде не читается и не пишется** — только тип `database.types.ts:1237` и явное исключение из истории `lib/spec/history.ts:517` |
| `client_discount` | `numeric NOT NULL` | то же: не используется, исключена из истории `lib/spec/history.ts:518` |
| `supplier_discount` | `numeric NOT NULL` | то же `lib/spec/history.ts:518` |
| `cutting_stock` | `numeric NOT NULL` | то же `lib/spec/history.ts:518` |
| `status` | `public.spec_status NOT NULL` | enum `draft\|picked\|approved\|ordered\|delivered\|replace` (дамп `:256`), метки `lib/spec/status.ts:3-54` |
| `is_placeholder` | `boolean NOT NULL` | заглушка; исключается из сумм `actions/spec-export.ts:103-105`, `hooks/use-spec-builder.ts:1487` |

Смежные таблицы:

* `spec_item_components.cost` и `.additional_cost` — `numeric` nullable
  (миграция `supabase/migrations/20260905_001_add_spec_item_components.sql:27`,
  `20260906_003_add_additional_cost_to_spec_item_components.sql:9-10`); в основные суммы
  материалов **не входят**, показываются текстом (`actions/spec-export.ts:54-60,79-93`).
* `spec_item_variants.price` — `numeric NOT NULL`, миграция
  `supabase/migrations/20260915_001_backfill_base_spec_item_variants.sql:16-23` (вставка из
  `spec_items.price`, `:41`); тип `lib/supabase/database.types.ts:1145`.
* `service_operations.amount` — `numeric NOT NULL` (`supabase/migrations/20260907_001_add_service_operations.sql:19`),
  CHECK `amount >= 0` (`:37-38`).
* `project_services.amount` — `number` только по сгенерированным типам
  (`lib/supabase/database.types.ts:486`); локальных миграций для таблицы нет, **требует
  проверки в БД**.
* `projects.budget` — `number | null` только по сгенерированным типам
  (`lib/supabase/database.types.ts:542`); читается в статистике проектов
  (`lib/queries.ts:595,606`) и валидируется как `z.number().min(0)`
  (`lib/validations.ts:140`).
* `materials.price` — существует (`lib/supabase/database.types.ts:215`), копируется в
  позицию при добавлении из библиотеки (`actions/materials.ts:302`), оттуда же статус
  `picked` при цене > 0 (`:304`). Правка материала библиотеку меняет, но **не** трогает
  уже добавленные позиции: `upsertMaterial` работает только с `materials`
  (`actions/materials.ts:33`), обновления `spec_items` по `material_id` в нём нет.

**Валюты в БД нет.** Ни одной колонки валюты нет ни в `spec_items` (дамп `:245-285`), ни в
других таблицах; единственное упоминание — литерал `currency: "RUB"` в payload события
(`lib/spec/history.ts:491`). Валюта зашита в UI (`₽` в `components/spec-builder/qty-price-block.tsx:65`
и др.).

## 3. Фиксация цены после заказа/закупки

**Проверено: фиксации нет.** Что именно смотрел:

* Поиск по репозиторию (`*.ts`, `*.tsx`) шаблонов `ordered_price|fixed|locked|frozen|
  purchase_price|actual_price|supplier_price|price_snapshot|snapshot_price|ordered_at|
  received_at|purchased_at` — осмысленных совпадений в домене цены нет: только
  `isBlockedIp`/`blocked` в импорте материалов (`lib/material-import/guards.ts:274`),
  `kind: "fixed"` как тип услуги (`lib/spec/service-type.ts:18`) и сообщения об ошибках в
  `actions/service-operations.ts:120-137`. Колонок платежа/фиксации в живом дампе
  `spec_items` нет вовсе (`.scratch/material-payments/research/00-postgrest-schema-raw.txt:245-285`).
* `setSpecItemPrice` (`actions/specifications.ts:697-762`): валидирует только значение
  (`:705`), читает `from` (`:715-722`), пишет `price` (`:737-743`), пишет событие
  (`:751-758`). **Ни одной проверки `status`**.
* `saveSpecItemPatch` (`actions/specifications.ts:101-229`): валидация схемы (`:114`), затем
  `update` по `id/project_id/org_id/deleted_at` (`:221-227`) — статус не проверяется.
  Единственный отказ по состоянию — недоступный/чужой родитель (`:194`).
* Схема патча (`lib/validations.ts:245-283`) не содержит ни `refine`, зависящего от
  статуса, ни запрета менять `price`/`qty`; исключение по смыслу — `manualSpecItemSchema`,
  где есть только проверка «скидка заказчику ≤ скидка поставщика» (`lib/validations.ts:382-390`).
* UI: `isLocked` (`lib/spec/status.ts:57-62`, статусы `approved|ordered|delivered`) передаётся
  только в `InlineCode` (поле марки): `components/spec-builder/spec-row.tsx:118`,
  `spec-card.tsx:77`, `spec-compact-card.tsx:110`, `spec-list-row.tsx:80`,
  `modals/details-header.tsx:91`. В блоке «количество/цена» цена **явно редактируема**:
  `components/spec-builder/qty-price-block.tsx:53-54` (`readOnly={false}`, вариант
  `readOnly={p.hasPriceMod}` закомментирован). В модалке деталей поля «Запас»/«Скидка»
  тоже без учёта статуса (`components/spec-builder/modals/tabs/modal-details-tab.tsx:164-199`).
  `isLocked` меняет только текст подтверждения удаления
  (`components/spec-builder/spec-builder.tsx:763-776`).
* Единственные запреты, зависящие от статуса, — про **услуги**, а не про цену:
  `SERVICE_OPERATION_BLOCKED_STATUSES` (`lib/constants.ts:624-631`) и проверка в
  `actions/service-operations.ts:342-349`; а также авто-перевод в `delivered` при
  исполнении доставки (`actions/service-operations.ts:442-467`, с явным комментарием
  «Никакие ценовые поля не трогаются», `:438`).

**Что есть вместо фиксации:** аудит. `buildPriceChangedEvents` формирует события с
`from`/`to`/`currency` (`lib/spec/history.ts:483-493`), но событие не сохраняет предыдущее
значение как действующее — это лента, а не «замороженная» цена.

## 4. Изменение количества и пересчёт суммы

* Точки изменения qty:
  * `incQty` — `hooks/use-spec-builder.ts:518-531`: `Math.max(0.01, round2(it.qty + delta))`,
    помечает патч `{ explicitQuantity: true }` (`:527`).
  * `setQty` — `hooks/use-spec-builder.ts:533-544`: `round2(n)`, отбрасывает `n <= 0`
    (`:536`), тоже `explicitQuantity`.
  * Поле-степпер: `components/layout/qty-stepper.tsx:51-59` (коммит черновика считает
    **дельту** `round2(n − qty)`, `:55`) и `:121-124`; кнопки «−/+» — `:91-95`, `:141-150`.
    Минимум 1 по кнопке «−» (`:95`), но `qty` в БД допускает `0.01` (`lib/validations.ts:264`).
  * Ручная форма: `qty: Number(watch("qty")) || 0` в предпросмотре
    (`components/spec-builder/modals/manual-item-form.tsx:139`) и ввод
    `components/spec-builder/modals/modals.tsx:204`.
  * У вариантов позиции **своего qty нет**: `spec_item_variants` хранит цену, но не
    количество (миграция `supabase/migrations/20260915_001_backfill_base_spec_item_variants.sql:16-33`),
    и `applyActiveVariant` перекрывает только `name/brand/article/spec/price/...`
    (`lib/spec/variants.ts:29-43`) — количество остаётся у позиции.
* Путь записи: `updateItem` (`hooks/use-spec-builder.ts:433-450`) — оптимистично правит
  состояние (`:445`) и кладёт патч в очередь `persist.push` (`:446`); сервер —
  `saveSpecItemPatch` → `update` (`actions/specifications.ts:221-227`), событие
  `quantity_changed` только при реальном изменении (`:237-246`, снимок «до» — `:368-389`).
* **Пересчёт итогов — производное от рендера, отдельного «пересчёта» нет:** суммы считаются
  `sumItems` в `useMemo` (`hooks/use-spec-builder.ts:1471-1532`) и `priceOf` в компонентах
  (`spec-row.tsx:76`, `summary-item-row.tsx:17`). Ни запас, ни округление по единице в
  хранимое `qty` не пишутся — только в расчёт (`lib/spec/pricing.ts:37-38`).
* Запас и скидки меняются отдельными патчами: `onPatch({ stockPct })` /
  `onPatch({ clientDiscountPct })` в `components/spec-builder/modals/tabs/modal-details-tab.tsx:178,195`
  (через `parseCommittedNumber`, `lib/utils.ts:37-42` — дробные значения допускаются).
* Сортировка «по сумме» в списке считает `qty * price` **без** запаса и скидок
  (`hooks/use-spec-builder.ts:1451`) — расхождение с `priceOf` в порядке строк.

## 5. Что можно менять после заказа и после получения

Статусная модель (`lib/spec/status.ts:3-54`, `lib/constants.ts:107-114`):
`draft` → `picked` → `approved` → `ordered` → `delivered`, плюс боковой `replace`.

* Смена статуса разрешена в любой из шести (`lib/spec/status.ts:65-71`), кроме заглушек,
  которым доступны только `draft|picked|replace` (`:68-69`). Откат назад и `replace` после
  закупки **не запрещены**, только предупреждаются текстом (`lib/spec/status.ts:74-88`);
  предупреждение в UI не блокирует запрос.
* Валидации «в этом статусе поле менять нельзя» в коде действий нет: `saveSpecItemPatch`
  (`actions/specifications.ts:101-229`), `setSpecItemPrice` (`:697-762`),
  `setSpecItemsStatus` (`:618-678`), `actions/spec-components.ts` (цена состава —
  `:601`, `:688`, `:1238`, `:1344`), `actions/spec-variants.ts` (`updateVariant:320-399`,
  `switchVariant:235-...`) — ни одна из этих функций не читает `status` позиции для
  отказа в правке цены/количества.
* Что действительно ограничено статусом:
  * включение позиции в новую операцию услуг: `delivery` запрещена для `replace` и
    `delivered`, `installation` — для `replace`, своя услуга — без ограничений
    (`lib/constants.ts:624-631`), проверка `actions/service-operations.ts:342-349`;
  * исполнение доставки переводит связанные позиции в `delivered`, минуя `replace`
    (`actions/service-operations.ts:442-467`);
  * поле марки в UI заблокировано для `approved|ordered|delivered`
    (`lib/spec/status.ts:57-62` + `components/spec-builder/spec-row.tsx:118`).
* «Получение» как отдельного события нет: `ordered` — это просто статус, а `delivered`
  ставится либо вручную через `setSpecItemsStatus`, либо доставкой
  (`actions/service-operations.ts:442`). Ни один из переходов не трогает цену.

## 6. Данные для расчёта денежных показателей

* **Материалы:** `sumItems(items).total` — билдер (`hooks/use-spec-builder.ts:1488,1513`),
  экспорт (`actions/spec-export.ts:157`). Экспорт при этом исключает заглушки
  (`actions/spec-export.ts:103-105`), а `sumItems` в билдере вызывается на всём `items`
  (`hooks/use-spec-builder.ts:1488`) — заглушки дают `price = 0` (`hooks/use-spec-builder.ts:985`),
  поэтому на практике не влияют, но формально наборы разные.
* **Услуги:** единственная точка — `sumServiceOperationAmounts` (`lib/spec/project-budget.ts:48-69`),
  агрегирует **по списку операций**, а не по связям `service_operation_items` (`:43-47`);
  вкладка «исполнено» и число связанных позиций на сумму не влияют (комментарий `:8-12`,
  поле `completed` приходит, но в расчёте не участвует — `lib/spec/public-spec.ts:19-20`).
* **Итог проекта:** `calcProjectTotal(materials + services)` (`lib/spec/project-budget.ts:76-81`),
  вызывается в экспорте (`actions/spec-export.ts:159-162`), в публичной странице
  (`app/share/spec/[token]/page.tsx:27`) и в PDF (`lib/spec/pdf-document.tsx:235`).
* **Разбивка:** `serviceBudgetRows` (`lib/spec/project-budget.ts:105-129`): свои услуги
  перечисляются поимённо только если их ≤ 2 (`:117-124`), иначе — строка «Свои услуги»
  (`:126`).

### 6.1 Найденные расхождения формул

1. **Сумма материалов.** `sumItems` округляет накопитель на каждом шаге
   (`lib/spec/pricing.ts:66`), а публичная страница и PDF суммируют сырые `priceOf().total`:
   `app/share/spec/[token]/page.tsx:25,31,45`, `lib/spec/pdf-document.tsx:233,243`. На
   целом примере (7 позиций с построчными итогами `0.34` и точной суммой `2.3471`)
   `sumItems` даёт `2.38`, сыпучая сумма — `2.3471` (то есть расхождение с тем же набором
   данных, который видит закупка в `hooks/use-spec-builder.ts:1488`). Проверено численно в
   этой сессии (node, копия формулы).
2. **Тип услуги в публичном канале.** `lib/spec/public-spec.ts:214-224` разбирает тип как
   «`delivery`, иначе `installation`» — своя услуга (`type = 'service'`, разрешена
   миграцией `supabase/migrations/20260917_001_add_custom_service_operations.sql:32-34`)
   попадает в `installation`. Последствия: `sumServiceOperationAmounts` складывает её в
   «Монтаж» (`lib/spec/project-budget.ts:59`), а `serviceBudgetRows` не может назвать её
   поимённо — ветка `op.type === "service"` (`lib/spec/project-budget.ts:109`) в публичном
   канале недостижима, и `operationLabel` вернёт «Монтаж»/«Доставка», а не название услуги
   (`lib/constants.ts:610-616`). В рабочем билдере та же услуга называется правильно
   (`components/spec-builder/summary/spec-summary.tsx:361`).
3. **Состав.** `spec_item_components.cost` (компоненты) и `additional_cost` (ссылки)
   показываются в UI/PDF/экспорте, но в бюджет проекта не входят
   (`actions/spec-export.ts:54-60`, комментарий `lib/spec/project-budget.ts:14-15`).
   В веб-сводке сумма услуг заголовка берётся из `ctx.servicesTotal`
   (`components/spec-builder/summary/spec-summary.tsx:349`), а строки статусов считают
   `priceOf` по всем позициям без округления (`:100,117`) — это второй вариант суммы,
   который может на копейки отличаться от `stats.totalSum` (`hooks/use-spec-builder.ts:1513`).
4. **Округление до рубля в карточке:** `components/spec-builder/spec-compact-card.tsx:208`
   показывает `fmt(Math.round(p.total))` — итог без копеек, тогда как `summary-item-row.tsx:59`
   и `spec-row.tsx` показывают копейки.
5. **Дублирование округления:** собственный `round2` есть у импорта материалов
   (`lib/material-import/normalize.ts:320-321`), а суммы операций округляются в
   `lib/spec/project-budget.ts:122` и `components/spec-builder/modals/service-operation-modal.tsx:47`
   — параллельные реализации одного правила.

## 7. Типы хранения денег и округление в JS

### 7.1 Типы в БД

* `spec_items.price`, `qty`, `base_price`, `client_discount`, `supplier_discount`,
  `cutting_stock`, `stock_pct`, `client_discount_pct`, `supplier_discount_pct` — все
  объявлены как **`numeric` без precision/scale**: живой дамп
  `.scratch/material-payments/research/00-postgrest-schema-raw.txt:253,255,274-280`
  (PostgREST отдаёт `numeric` без `(p,s)`, значит ограничение не задано). То же
  подтверждают сгенерированные типы (`lib/supabase/database.types.ts:1237-1269`).
  Локальных миграций `spec_items` нет — базовые таблицы в `supabase/migrations/` не
  создаются (в каталоге 17 файлов миграций, `create table public.spec_items` ни в одном
  из них нет). **Вывод: деньги — не целые копейки, а
  `numeric` переменной точности.**
* `spec_item_variants.price` — `numeric NOT NULL` (дамп `:232`), создаётся/бэкфиллится
  миграцией `supabase/migrations/20260915_001_backfill_base_spec_item_variants.sql:16-23`.
* `spec_item_components.cost` / `additional_cost` — `numeric` (миграции
  `20260905_001_add_spec_item_components.sql:27`,
  `20260906_003_add_additional_cost_to_spec_item_components.sql:9`).
* `service_operations.amount` — `numeric NOT NULL` + CHECK `>= 0`
  (`supabase/migrations/20260907_001_add_service_operations.sql:19,37-38`).
* `projects.budget`, `project_services.amount`, `materials.price` — только по
  сгенерированным типам `number` (`lib/supabase/database.types.ts:542,486,215`);
  **локальных объявлений нет, требуют проверки в БД.**
* Ни `integer`-копеек, ни `real`/`double precision`, ни `money` в денежных колонках не
  найдено ни в миграциях, ни в живом дампе.

### 7.2 Где деньги округляются в JS

* `round2` (единственная «доменная» реализация) — `lib/spec/pricing.ts:6`; применяется в
  `pricing.ts:38,41,42,44,45,50,53,56,66-68`.
* `round2` в бюджете услуг — `lib/spec/project-budget.ts:64-67,80,122`.
* `Math.round(n*100)/100` в:
  * валидации цены `money` (`lib/validations.ts:242`) — цена и патч приводятся к копейкам
    на сервере;
  * `incQty` / `setQty` / `setPrice` (`hooks/use-spec-builder.ts:523,539,558`) — то есть
    количество тоже квантуется до 2 знаков **до** умножения на запас;
  * дельте степпера (`components/layout/qty-stepper.tsx:55`);
  * сумме операции услуги (`components/spec-builder/modals/service-operation-modal.tsx:47`);
  * импорте материалов (`lib/material-import/normalize.ts:312,315,320-321`).
* `round2` билдера применён и к марже (`hooks/use-spec-builder.ts:1516`) — второй расчёт
  маржи после `priceOf().margin` (`lib/spec/pricing.ts:56`).
* Представление `spec_items_priced` отдаёт `qty_final`/`price_final` уже посчитанными
  (`.scratch/material-payments/research/00-postgrest-schema-raw.txt:323-324`) — если его кто-то использует вне
  этого репозитория, там третья реализация формулы; в приложении она не задействована.

### 7.3 Риск накопления расхождения

Округление «на каждом шаге» (`sumItems`) и «в конце» (страница шаринга/PDF) дают разные
итоги на одних данных: расчёт выше — `2.38` против `2.3471` при 7 позициях; на 1000
позициях с `qty = 1/3`, `price = 0.01` — `10.00` против `9.999999999999831`. Плюс:
хранение `numeric` без scale позволяет записать в `price` больше двух знаков, и на пути
создания позиций это ничем не ограничено: `createSpecItems` **не** вызывает
`specItemCreateSchema` (в `actions/specifications.ts` нет ни одного его использования),
а `patchToRow(it)` кладёт значения клиента прямо во вставку
(`actions/specifications.ts:817-835`). Серверный `money`-transform
(`lib/validations.ts:238-242`) работает только там, где вызывается `specItemPatchSchema`:
`saveSpecItemPatch` (`actions/specifications.ts:114`), `setSpecItemPrice` (`:705`) и
`createManualSpecItem` через `manualSpecItemSchema` (`:874`). Итого три места, способные
дать расхождение «в копейку»: накопитель `sumItems`
(`lib/spec/pricing.ts:66`), сырые reduce в share/PDF (`app/share/spec/[token]/page.tsx:25`,
`lib/spec/pdf-document.tsx:233`) и `Math.round` в карточке
(`components/spec-builder/spec-compact-card.tsx:208`).

## Открытые вопросы

1. **Точные типы денежных колонок в живой БД.** Отсутствие `(p,s)` у `numeric` видно по
   дампу, но `information_schema.columns.numeric_precision/numeric_scale` в
   `temp/introspect.sql:10` ещё не выполнялся (в репозитории результата нет). Нужен живой
   запрос: `numeric(12,2)` и `numeric` без ограничения ведут себя по-разному.
2. **Объявления `spec_items`, `materials`, `projects`, `project_services` в БД.** В
   локальных миграциях их нет — по генерированным типам видно лишь существование колонок;
   нужны `pg_get_constraintdef` и `information_schema` по этим таблицам (CHECK на `qty`,
   `price`, знак скидок, `stock_pct in (0..100)`).
3. **Масштаб `stock_pct` на реальных данных.** Код трактует как проценты
   (`lib/spec/pricing.ts:37`), форматтер истории — как долю единицы
   (`lib/spec/activity-format.ts:284`). Нужен `select stock_pct from spec_items limit N`,
   чтобы понять, лежат ли там `5`/`10` или `0.05`/`0.1`.
4. **Реальное содержимое `spec_items_priced`.** Определение представления (SQL) в
   репозитории отсутствует; неизвестны ни его формула, ни потребители. Нужен
   `pg_get_viewdef('public.spec_items_priced')` и список объектов, от него зависящих.
5. **Назначение `base_price`, `client_discount`, `supplier_discount`, `cutting_stock`.**
   Живые колонки, в коде приложения не читаются и не пишутся (кроме исключения из истории,
   `lib/spec/history.ts:517-518`) — возможно, наследие. Нужны значения и `NOT NULL`-дефолты.
6. **Триггеры БД на `spec_items`.** Есть ли в живой БД триггеры, переписывающие
   `price`/`qty`/`updated_at` (в локальных миграциях их нет, но базовые таблицы создавались
   вне репозитория). Проверяется `information_schema.triggers`, запрос уже подготовлен в
   `temp/introspect.sql:64-69`.
7. **Статусные CHECK/триггеры.** Подтверждён только enum `spec_status`
   (дамп `:256`); неизвестно, есть ли в БД ограничения переходов (например, запрет
   `delivered → draft`).
8. **Права.** Кто может менять цену в каком статусе — проверяется ли это RLS/политикой на
   `spec_items` или только `lib/permissions.ts`; в прочитанных миграциях политик для
   `spec_items` нет.
9. **`smoke`-проверка расхождения сумм** на реальной спецификации: сравнить
   `sumItems(items).total` (экспорт Excel) и итог публичной страницы для одного проекта —
   подтвердить или опровергнуть §6.1.1 на боевых данных.
