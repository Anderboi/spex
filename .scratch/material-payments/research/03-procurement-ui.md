# 03. Воронка закупки/поставки в UI и механизмы обновления данных

Этап 1 исследования под модель платежей по материалам (график платежей + фактические оплаты). Пометки: **код** — проверено чтением исходников; **типы** — только по сгенерированным `lib/supabase/database.types.ts` (указывает на существование колонки, требует проверки в БД); **предположение** — вывод, не подтверждённый кодом.

## Краткое резюме

1. Воронка закупки — три статуса `PROCUREMENT_FLOW = [approved, ordered, delivered]` (`lib/constants.ts:235`), подбор — `PICKING_FLOW = [draft, picked]` (`lib/constants.ts:240`); словарь подписей/цветов один — `SPEC_STATUS_CONFIG` (`lib/spec/status.ts:3`).
2. `ctx.stats` считает деньги только через `priceOf().total` (цена заказчику) — `sumItems` в `hooks/use-spec-builder.ts:1486`; закупочная сумма (`purchaseTotal` со скидкой студии) вычисляется, но в бакеты не попадает (`lib/spec/pricing.ts:62`, `hooks/use-spec-builder.ts:1493`).
3. `scopeSum/scopeCount` — только неплейсхолдерные позиции в `approved/ordered/delivered` (`hooks/use-spec-builder.ts:1487,1500`); `deliveredPct` — доля по ДЕНЬГАМ, а подпись под ней — по количеству (`hooks/use-spec-builder.ts:1527-1530`, `components/spec-builder/modals/procure-modal.tsx:80`).
4. `ProcureModal` — единственная сводка воронки: открывается из шапки проекта по `?dialog=procure` (`app/(protected)/[orgSlug]/projects/[id]/page.tsx:50`, `components/project/project-actions.tsx:52`), сама ничего не грузит, живёт на `ctx.stats`/`ctx.items`, строки ведут в карточку через `ctx.openDetail` (`components/spec-builder/modals/procure-modal.tsx:139`).
5. Платежей в схеме нет вообще: ни таблиц, ни колонок — живая схема (`.scratch/material-payments/research/00-postgrest-schema-raw.txt:245`) и типы (`lib/supabase/database.types.ts:1231`); ближайший аналог «сущность с суммой и сроком» — `service_operations` (`.../00-postgrest-schema-raw.txt:150`).
6. Карточка позиции обновляется НЕ через `router.refresh`: `items` живёт в `useState` и не синхронизируется с пропсами (`hooks/use-spec-builder.ts:218`) — `revalidatePath` в actions до открытого конструктора не доходит, данные в UI возвращает ответ самого action.
7. Realtime-подписок Supabase нет нигде (grep `postgres_changes`/`.channel(` — 0 совпадений в `*.ts*`).
8. В браузере Supabase-клиента нет: только service-role админ на сервере (`lib/supabase/admin.ts:4`); anon-ключ встречается лишь в интеграционном тесте (`integration/spec-item-files.int.test.ts:63`).
9. Прецедент «новая дочерняя таблица позиции» — `spec_item_files` (миграция `supabase/migrations/20260927_001_add_spec_item_files.sql:35`, RLS только на SELECT, запись через service role).
10. Рекомендуемая точка входа для платежей — карточка материала (блок в «Обзоре» или вкладка), `ProcureModal` — сводка только на чтение, `SpecSummary` — проектный итог (прецедент единой точки расчёта — `lib/spec/project-budget.ts:43`).

## 1. Статусы позиции, подписи, цвета, порядок воронки

**Полный перечень** (`lib/constants.ts:215`): `draft, picked, approved, ordered, delivered, replace` (порядок объявления). Тип — `Enums<"spec_status">` (`lib/constants.ts:223`), в БД — `public.spec_status` (`lib/supabase/database.types.ts:1737`).

**Подписи и цвета — `SPEC_STATUS_CONFIG`** (`lib/spec/status.ts:3-54`), код цитатой:

```ts
// lib/spec/status.ts:13-53
draft:     { label: "Не выбрано",  dot: "bg-fg-muted",   bar: "#9b968c" },
picked:    { label: "Подобрано", sub: "готово к согласованию",  bar: "#3b82f6" },
approved:  { label: "Согласовано", sub: "ожидает заказа",        bar: "#10b981" },
ordered:   { label: "Заказано",  sub: "в производстве или пути", bar: "#f59e0b" },
delivered: { label: "Доставлено", sub: "на объекте",             bar: "#047857" },
replace:   { label: "Заменить",  sub: "брак или пересмотр",      bar: "#dc2626" },
```

**Порядок воронки закупки** (`lib/constants.ts:234-240`, код):

```ts
/** Стадии закупки — порядок важен для прогресс-бара */
export const PROCUREMENT_FLOW: SpecStatus[] = ["approved", "ordered", "delivered"];
export const PICKING_FLOW: SpecStatus[] = ["draft", "picked"];
```

**Смысловые соответствия вопроса** (код — только по подписям `sub`, отдельных полей «в закупке» нет): «заказано» = `ordered` («Заказано», «в производстве или пути»); «в закупке» как отдельного статуса НЕТ — так называется вся воронка `PROCUREMENT_FLOW` и блок сводки; «доставлено» = `delivered`; «требует замены» = `replace`; «в подборе» = `draft` + `picked` (`PICKING_FLOW`).

**Производные правила** (`lib/spec/status.ts:56-89`): `LOCKED_STATUSES = [approved, ordered, delivered]` и `isLocked()` — «позиция зафиксирована: марка в чертежах, деньги потрачены» (`:56-62`); `allowedStatuses()` — заглушке доступны только `draft/picked/replace` (`:65-71`); `statusWarning()` предупреждает при переводе в `replace` из locked-статуса («уже в закупке») и при откате назад (`:74-89`). UI смены статуса — `components/spec-builder/layout/status-menu.tsx:45,100-120`.

**Расхождение словарей (код):** `SPEC_STATUS_LABEL.ordered = "Приобретено"` (`lib/constants.ts:229`), а `SPEC_STATUS_CONFIG.ordered.label = "Заказано"` (`lib/spec/status.ts:34`). Первый используется только в тексте истории (`lib/spec/activity-format.ts:216`), второй — во всём интерфейсе, экспорте и PDF (`actions/spec-export.ts:45`, `lib/spec/pdf-document.tsx:326`, `components/spec-builder/summary/spec-summary.tsx:106`).

## 2. `ctx.stats` в `hooks/use-spec-builder.ts`

Всё считается в одном `useMemo` — `hooks/use-spec-builder.ts:1486-1532`, зависимость только `[items]`.

**Формулы (код):**

| Значение | Строки | Определение |
|---|---|---|
| `real` | 1487 | `items.filter(i => !i.isPlaceholder)` — заглушки исключены |
| `money` | 1488 | `sumItems(items)` — по ВСЕМ позициям, включая заглушки |
| `bucket(s)` | 1491-1494 | `{ items, count, sum: sumItems(its).total }` по `real` с данным статусом |
| `procurement` | 1496-1498 | `Record<status, StatusBucket>` только для `PROCUREMENT_FLOW` |
| `scopeSum` | 1500-1503 | `Σ procurement[s].sum` по `approved+ordered+delivered` |
| `scopeCount` | 1504-1507 | `Σ procurement[s].count` по тем же трём |
| `picking` | 1508 | `PICKING_FLOW.flatMap(s => bucket(s).items)` → `draft` + `picked` |
| `replace` | 1509 | `bucket("replace")` |
| `pickingCount` / `pickingSum` | 1525-1526 | `picking.length` / `sumItems(picking).total` |
| `deliveredCount` | 1527 | `procurement.delivered.count` |
| `deliveredPct` | 1528-1530 | `scopeSum ? Math.round(delivered.sum / scopeSum * 100) : 0` |
| `totalSum/discountSum/purchaseSum/margin` | 1513-1516 | из `money` (все позиции, включая заглушки) |

**Из каких полей берутся суммы (код).** `sumItems` → `priceOf(i)` (`lib/spec/pricing.ts:31-60`); вход — `qty, unit, price, stockPct, clientDiscountPct, supplierDiscountPct` (плоские поля позиции; активный вариант уже наложен на них через `applyActiveVariant` — `lib/queries.ts:669-673`). `qtyFinal = qty*(1+stockPct/100)`, для «штучных» единиц — `Math.ceil` (`lib/spec/pricing.ts:36-38`); `priceFinal = price*(1-clientDiscountPct/100)` (`:41`); **`total = qtyFinal*priceFinal`** (`:44`) — это то, что видит заказчик; `purchaseTotal = qtyFinal*price*(1-supplierDiscountPct/100)` (`:45`) — закупка со скидкой студии.

**Что попадает в scope (код):** только неплейсхолдерные позиции со статусами `approved`, `ordered`, `delivered`. **Что не попадает:** `draft`, `picked` (они в `picking`), `replace` (в `replace`), все заглушки; и — важно для платежей — `totalSum` считается по всем позициям (`:1488`), то есть «Итого» в нижней панели и «Сумма в закупке» в модалке — разные базы.

**Что уже посчитано, но выброшено (код):** `sumItems` возвращает `{ total, purchase, discount }` (`lib/spec/pricing.ts:62-72`), но бакет берёт только `.total` (`hooks/use-spec-builder.ts:1493`) — закупочная сумма по стадиям воронки нигде не хранится, хотя доступна одной строкой. Для модели платежей это готовый источник «сколько мы должны поставщику по каждой стадии».

**Несоответствие подписи и метрики (код):** `deliveredPct` считает долю по деньгам (`:1528-1530`), а рядом выводится `{deliveredCount} из {scopeCount} позиций доставлено` (`components/spec-builder/modals/procure-modal.tsx:80`) — числа могут расходиться.

**`ctx.stats` наружу:** `hooks/use-spec-builder.ts:1977` (в составе `SpecBuilderContext`, тип — `:2084`).

## 3. `components/spec-builder/modals/procure-modal.tsx`

**Что показывает (код).** Сводка воронки в `Drawer` (не `Dialog`), читает только `ctx.stats` (`procure-modal.tsx:18-27`) и `ctx.items` внутри бакетов:
пустое состояние «Закупка ещё не началась» при `scopeCount === 0` (`:31-49`); заголовок «Закупка и поставка» (`:65-69`); процент `deliveredPct` и `deliveredCount из scopeCount` (`:74-91`); сумма `fmt(scopeSum) ₽` (`:87-89`);
цветная полоса-прогресс по `PROCUREMENT_FLOW` с шириной `procurement[s].sum / scopeSum` (`:51-54`, `:94-101`);
по каждой стадии — заголовок со счётчиком и суммой (`:104-131`) и список позиций «код · название/бренд · qty×price · total» (`:133-163`);
красный блок «Требуют замены» с первыми тремя позициями и кнопкой «Открыть в списке →» (`:169-211`); серая строка «Ещё в подборе · N» с `pickingSum` («до закупки») (`:213-226`).

**Откуда открывается — все места (код):**

1. шапка проекта, ≥640px — кнопка «Закупка» (`components/project/project-actions.tsx:49-57`);
2. шапка проекта, <640px — пункт меню «…» (`components/project/project-actions.tsx:79-84`);
3. ссылка `?dialog=procure` формируется на сервере (`app/(protected)/[orgSlug]/projects/[id]/page.tsx:50,85`);
4. `?dialog=procure` → `ctx.openProcure()` в эффекте конструктора (`components/spec-builder/spec-builder.tsx:186-193`), сам `openProcure` — `setModal({kind:"procure"})` (`hooks/use-spec-builder.ts:1673`), рендер — `components/spec-builder/spec-builder.tsx:702-704` (ленивый `dynamic`-импорт, `:71-72`);
5. **мёртвые/отключённые входы:** кнопка «Закупка» в нижней панели закомментирована (`components/spec-builder/layout/bottom-bar.tsx:97-103`); `onProcure` передаётся в `handlers`, но в типе `SpecRowHandlers` его нет и ни один рядок его не вызывает (`components/spec-builder/spec-builder.tsx:220`, `components/spec-builder/spec-row.tsx:38-57`); легаси-копия модалки `components/spec-builder/modals/modals.tsx:752-1143` (`data-modal="procure"`) ниоткуда не импортируется.

**Связь с фильтрами и `ctx.openDetail` (код).** Клик по позиции стадии → `ctx.openDetail(it.id)` (`procure-modal.tsx:139`), в блоке замены — то же (`:195`); `openDetail` закрывает верхние слои и пишет `?item=&tab=` в URL (`hooks/use-spec-builder.ts:1624-1642`), то есть из сводки открывается полноценная карточка. Единственная связь с фильтрами — кнопка «Открыть в списке →»: `ctx.filters.setStatusFilter("replace")` и закрытие модалки (`procure-modal.tsx:180-183`); `setStatusFilter` пишет `?status=` через `history.replaceState` (`hooks/use-spec-filters.ts:19-29,52`), который фильтрует `list` (`hooks/use-spec-builder.ts:1437`).

**Что уже есть под будущий блок «Платежи» (оценка с опорой на код).** Есть группировка по стадиям воронки с суммами и количеством (`procurement[s].sum/count`), проектный итог `scopeSum`, строки позиций с готовым `priceOf(it)` (`:134`, `:190`) и переход в карточку. Нет: поставщика (хотя `it.companyId/companyName` доступны), срока поставки (`it.leadTime`), дат (`it.updatedAt`), истории оплат, закупочной суммы (`purchaseTotal` отброшен), разреза по поставщикам и по времени. Дат в модалке нет ни одной — под «график платежей» здесь потребуется новый источник данных, а не переиспользование существующего рендера.

## 4. Карточка материала: `spec-mat-detail-modal.tsx` и вкладки

**Актуальный состав вкладок (код)** — `components/spec-builder/modals/spec-mat-detail-modal.tsx:286-295`: `Обзор` (`overview`), `Параметры` (`parameters`), `Состав` (`components`), `Файлы` (`files`), `Комментарии` (`comments`).
В брифе задачи вкладок «Поставка и помещения»/«Заметки» **нет**: поставщик, менеджер и срок — раскрытый блок «Поставка» внутри «Обзора» (`components/spec-builder/modals/tabs/overview-tab.tsx:237-280`), помещения — блок «Помещения» там же (`:282-306`), «Заметки» — секция внутри вкладки «Параметры» (`components/spec-builder/modals/tabs/modal-details-tab.tsx:220-236`).
Отдельная вкладка «Поставка» выведена из обращения и редиректится в `overview` (`hooks/use-spec-builder.ts:94-102`).
Файлы-заглушки `modals/tabs/supply-tab.tsx:3-9`, `modals/tabs/components-tab.tsx:3-9`, `modals/tabs/variants-tab.tsx:8` не импортируются ни одним модулем (мёртвый код).

**Как устроены вкладки (код).** `Tabs` со `value = useState(initialTab ?? "overview")` (`spec-mat-detail-modal.tsx:208`), смена — `changeTab`, который дополнительно пишет `?tab=` (`:217-220`; `onTabChange` → `setDetailTab`, `hooks/use-spec-builder.ts:1648-1654`). Контракт вкладок — `DETAIL_PANEL_TABS` (`hooks/use-spec-builder.ts:83-91`), значение из URL валидируется (`:104-116`). Скролл — по вкладке через обёртку `ScrollableTab` (`spec-mat-detail-modal.tsx:47-73`); `comments` намеренно без `ScrollArea` (`:364-379`).

**Как добавляются блоки (код).** Внутри вкладки — компоненты-секции; для «Обзора» есть универсальный аккордеон `OverviewSection({icon,title,summary,action,children})` (`components/spec-builder/layout/overview-section.tsx:18-79`), чей комментарий задаёт планку: «Обзор» — короткий список состояния позиции, а не второй редактор (`:12-17`). Новая вкладка добавляется правкой `DETAIL_PANEL_TABS` + `TabsList` + ветки `TabsContent`.

**Откуда вкладка берёт данные (код).**
`overview` — из `ctx.items`: проп `item` (уже с наложенным активным вариантом) плюс производные (`overview-tab.tsx:137-208`); поставщики/контакты — из пропсов страницы (`app/(protected)/[orgSlug]/projects/[id]/page.tsx:102-104`); услуги — из `ctx.operations` (`overview-tab.tsx:471-482`).
`parameters` — только `item` + `onPatch` (`spec-mat-detail-modal.tsx:346`).
`components` — собственный запрос `listSpecItemComponents` в локальный `rows` (`components/spec-builder/modals/spec-components-section.tsx:88-89,199-217`).
`files` — собственный запрос `listSpecItemFiles` в локальный `files` (`components/spec-builder/modals/tabs/files-tab.tsx:161-164,248-264,298-315`).
`comments` — собственный запрос `getSpecItemActivity` в локальный `records` (`components/spec-builder/modals/tabs/activity-tab.tsx:131-139,155-172,190-196`).

**Прецеденты, на которые опираться при добавлении блока платежей (код):**

- *Файлы:* локальное состояние + server action, возвращающий записи; защита от гонки счётчиком `requestIdRef`; в список кладётся серверная запись, а не локальная догадка; удаление — только после успеха, без оптимистичного удаления (`files-tab.tsx:241-315,522-589`).
- *Комментарии:* подтверждённые записи в `records`, незавершённые операции — в `Map<commentId, PendingCommentMutation>`; откат = удаление записи из Map; порядок «optimistic → запрос → серверная запись либо откат», один активный запрос на сущность (`components/spec-builder/modals/activity/use-comment-mutations.ts:26-49,141-196,212-244`).
- *Состав:* загрузка списка в `rows`, мутации возвращают строку и заменяют/добавляют её локально (`spec-components-section.tsx:309-334`), ошибка — в форму (`:305-308`).
- *Услуги:* единый список проекта в `ctx.operations` + локальные `onOperationCreated/Updated/Deleted` без перезагрузки (`hooks/use-spec-builder.ts:262-307,1860-1898`), бейджи по позиции — `ctx.opsByItem` (`:1948-1958`).
- *Предпросмотр состава в «Обзоре»* — отдельный компонент со своим запросом и сводкой (`components/spec-builder/layout/components-preview.tsx:5,60-63`): образец «лёгкий блок в Обзоре, тяжёлый редактор на своей вкладке».

## 5. Механизмы обновления данных после мутаций

**Общий контракт (код).** Все actions возвращают `ActionResult<T>` = `{success,data}` | `{success:false,error,code}` (`lib/action-result.ts:32-34`), помечены `"use server"` (например `actions/service-operations.ts:1`), авторизуются через `requireOrgBySlug` (`actions/specifications.ts:43`) и пишут через service-role клиент (`:44`). Вызовы — прямые из компонентов/хуков; **`router.refresh()` в конструкторе спецификации не вызывается ни разу** (grep: совпадения только в auth/проектах/настройках).

**Ключевой факт (код):** `items` — это `useState(initialItems)` (`hooks/use-spec-builder.ts:218`), эффекта синхронизации с пропсами нет (единственный ref-эффект — `itemsRef`, `:310-313`). `revalidatePath` обновляет серверный рендер страницы, но уже открытый конструктор перерисовывается только из собственного состояния, которое меняют сами обработчики.

| Мутация | Как данные попадают обратно в UI | `revalidatePath` |
|---|---|---|
| `saveSpecItemPatch` (правка полей) | локально сразу в `updateItem` (`hooks/use-spec-builder.ts:445`) + патч в дебаунс-очередь `persist.push` (`:446`; `hooks/use-spec-persistence.ts:53-61` — 800 мс, `flush` при `visibilitychange`/unmount `:64-73`); при ошибке — статус `error` и тост | `actions/specifications.ts:353` |
| `setSpecItemsStatus` (один/массово) | локально сразу (`hooks/use-spec-builder.ts:503-505`, `1325-1327`), затем `persist.flush()` и action в `startTransition` (`:507-513`, `1329-1333`); при ошибке — тост, локальное состояние не откатывается (код) | `:676` |
| `setSpecItemPrice` | локально (`:561`) + отдельный action (очередь `use-spec-persistence` не участвует) | `:760` |
| `createSpecItems` | оптимистичная вставка `setItems([...prev, ...created])` и откат по ошибке (`:1022-1036`) | `:859` |
| `createManualSpecItem` | локальная вставка (`:1174`) с откатом (`:1185`) | `:943-944` (+ `/materials` при создании материала) |
| `deleteSpecItems` / `restoreSpecItems` | оптимистичное удаление (`:1259`) + откат при ошибке (`:1274-1278`), «Отменить» в тосте → restore (`:1281-1293`) | `:996`, `:1048` |
| `setSpecItemCode` | сначала `persist.flush()`, затем action; при `CODE_TAKEN:` — диалог конфликта; при `swapped` — локальный обмен марками (`:868-913`) | `:1131` |
| варианты `add/switch/update/deleteVariant` | локальное зеркало с `applyActiveVariant` (`:645-663`, `841-859`, `:354`), action в `startTransition`, ошибка — только тостом | `actions/spec-variants.ts:225,308,419,523` |
| файлы `list/upload/getUrl/delete` | список — локальный `useState` + `useEffect` на смену позиции; загрузка кладёт серверную запись (`files-tab.tsx:583-589`); удаление — фильтр списка только после успеха (`:554`) | upload `:241`, delete `:312` (у `list`/`getUrl` — нет) |
| комментарии `create/update/delete` | optimistic-запись в ленте (`use-comment-mutations.ts:141-196,212-244`), серверная запись заменяет её через `onUpdated`; `getSpecItemActivity` читает курсором (`activity-tab.tsx:155-172,198-212`) | `actions/spec-comments.ts:116,150,182` |
| услуги `create/update/delete` | список проекта грузится эффектом (`hooks/use-spec-builder.ts:282-296`), далее локальные `onOperationCreated/Updated/Deleted` (`:1860-1898`); `addExistingServiceToItem` заменяет операцию и может пометить материалы доставленными (`:1829-1854`, `:1804-1814`) | `actions/service-operations.ts:597,780,874` |
| состав `create/update/delete/move/group/ref` | загрузка в `rows` (`spec-components-section.tsx:199-217`), мутации возвращают строку и правят список локально (`:309-334`, аналогично `:378-560`) | `actions/spec-components.ts:634,703,777,916,1006,1065,1154,1279,1361,1447` |

**Кэш (код):** `revalidatePath` — единственный механизм; `revalidateTag`/`unstable_cache`/`noStore` не используются (grep — 0 совпадений). Данные конструктора читает `getProjectSpecItems` через service-role клиент (`lib/queries.ts:610-674`), React-кэш `cache()` — только для сессии (`lib/auth/session.ts:56`). Realtime-подписок нет (grep).

**Следствие для платежей (предположение, из кода выше):** новая мутация должна (а) вернуть серверную запись целиком и (б) быть отражена в локальном состоянии вызывающего компонента — иначе до перезагрузки страницы UI её не увидит, так как `revalidatePath` до открытой карточки не доходит.

## 6. Клиент Supabase

**Что есть (код).** Единственная фабрика — `createAdminClient()` на `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts:4-14`); `lib/supabase/rpc.ts:4-17` — типизированная обёртка над `supabase.rpc` (`callRpc`). Файлов `lib/supabase/client.ts`/`server.ts` и зависимости `@supabase/ssr` в проекте нет (grep `createBrowserClient`/`@supabase/ssr` — 0 совпадений в исходниках).

**Кто каким пользуется (код).** service-role — все actions (`actions/specifications.ts:44`, `actions/spec-components.ts:95`, `actions/spec-comments.ts:48`, `actions/spec-variants.ts:34`, `actions/service-operations.ts:81`, `actions/spec-item-files.ts:86`), все чтения (`lib/queries.ts:49,149,200`), сессия (`lib/auth/session.ts:62`), Storage (`lib/material-import/storage.ts:107`), публичная спецификация (`lib/spec/public-spec.ts:50`). Anon-клиент — только интеграционный тест (`integration/spec-item-files.int.test.ts:63,94`).

**Какие таблицы читаются напрямую из браузера:** ни одной (код: grep `supabase`/`createClient` по каталогу `components` — 0 совпадений). Браузер ходит за данными исключительно через server actions и серверные компоненты.

## 7. Оценка: где размещать график платежей и фактические оплаты

Аргументы из кода, общие для всех вариантов:

- платежей нет в БД (`.scratch/material-payments/research/00-postgrest-schema-raw.txt:245-285` — в `spec_items` только `price/base_price/*_discount*`; `:150-162` — в `service_operations` только `amount/deadline/completed`; таблиц платежей в списке `== … ==` нет), значит нужен новый источник данных и новый UI;
- денежные величины уже считаются централизованно (`priceOf`/`sumItems`, `lib/spec/pricing.ts:31-72`) и один раз агрегируются в `ctx.stats` (`hooks/use-spec-builder.ts:1486-1532`) — дублировать расчёты не нужно, если блок читает `ctx.stats`/`ctx.items`;
- прецедент «единая точка расчёта проектного агрегата» — `lib/spec/project-budget.ts:43-69`, из него собираются сводка, экспорт и PDF (`components/spec-builder/summary/spec-summary.tsx:23,121-127,397-409`);
- прецедент новой дочерней таблицы позиции — `spec_item_files` (RLS только на SELECT, запись через service role, индекс `(spec_item_id, created_at desc)` — `supabase/migrations/20260927_001_add_spec_item_files.sql:35,101,139-142`);
- прецедент расширения журнала событий — отдельные миграции, переписывающие `spec_item_events_kind_check` (`supabase/migrations/20260919_001_add_parent_changed_event_kind.sql:16-22`), список синхронизирован с `SPEC_ITEM_EVENT_KINDS` (`lib/spec/history.ts:39-62`).

**Вариант A. `ProcureModal` как сводка + переход в карточку.**
*Плюсы:* это уже названная «воронка закупки и поставки» с группировкой по стадиям и суммами (`procure-modal.tsx:104-166`), строки уже открывают карточку (`:139,195`), данные бесплатны — `ctx.stats`/`ctx.items`.
*Минусы:* модалка не место для правки графика — в ней нет ни форм, ни сохранения, ни дат (`procure-modal.tsx` целиком read-only); группировка по статусу, а платёж привязан к позиции; собственного состояния нет, а `revalidatePath` до неё не доходит — сводка пересчитается только из локального `ctx.items`, если мутации идут через хук.
*Прецеденты:* `ctx.openDetail` из сводки (`procure-modal.tsx:139`), бейджи услуг в списке (`hooks/use-spec-builder.ts:1948-1958`).

**Вариант B. Карточка материала: блок «Платежи» в «Обзоре» (лёгкий) или вкладка (тяжёлый).**
*Плюсы:* деньги материала — домен позиции, здесь уже живут цена/скидка/поставщик/срок (`overview-tab.tsx:230-280`), данные из `ctx.items` без запросов; инлайн-правка блока — готовый паттерн `OverviewSection` + `RoomsEditor` (`overview-section.tsx:18-79`, `overview-tab.tsx:301-305`); при тяжёлой таблице — своя вкладка с прецедентами загрузки (Файлы `files-tab.tsx:248-315`, Комментарии `activity-tab.tsx:155-196`) и записью через optimistic (`use-comment-mutations.ts:141-196`); вкладка входит в URL-контракт `?tab=` (`hooks/use-spec-builder.ts:83-91`).
*Минусы:* `OverviewSection` документирован как «сводка, а не второй редактор» (`overview-section.tsx:12-17`) — полноценный редактор графика туда не влезает; новая вкладка требует правки `DETAIL_PANEL_TABS` + `TabsList` (`spec-mat-detail-modal.tsx:286-295`) и нового набора состояний загрузки; карточка начнёт сама ходить в БД, а не только читать `ctx.items`.

**Вариант C. Проектный уровень: блок в `SpecSummary` (и/или отдельная сводка платежей проекта).**
*Плюсы:* там уже живут все деньги проекта — «Стоимость материалов», разбивка услуг, «Общий бюджет» (`spec-summary.tsx:385-419`) — и есть прецедент подгрузки проектного агрегата на открытии (`:63-85`); единая точка вычислений (`project-budget.ts:43-69`) — естественное место для «план платежей / оплачено / остаток» в разрезе поставщиков и месяцев.
*Минусы:* сводка ориентирована на печать/экспорт/шеринг (`clientView`, PDF/Excel — `:131-190`, `:192-268`) — ввод фактических оплат там чужероден; агрегаты `SpecSummary` считаются локально из `ctx.items` (`:98-119`), расчёты по платежам придётся держать отдельно и не дублировать.

**Вывод (оценка):** систему учёта платежей логичнее держать в карточке материала — вариантами B (блок в «Обзоре» для лёгкого вида «план/оплачено», вкладка для полного графика), тогда как A остаётся сводкой воронки (переиспользует `ctx.stats`, добавить туда только чтение агрегатов), а C — проектной сводкой «сколько всего запланировано и оплачено». Это соответствует существующему разделению: `ctx.stats` — воронка, `project-budget.ts` — проектный итог, карточка — редактирование домена позиции.

## Открытые вопросы

1. Платежи как отдельная таблица-потомок позиции (прецедент `spec_item_files`) или как поля `spec_items`? Ни того, ни другого в живой схеме нет (raw `:245-285`); в репозитории базовые таблицы не создаются — миграции только добавляют дочерние сущности.
2. Платёж привязан к материалу-позиции или к заказу/партии у поставщика? Сущности «заказ» в коде нет: ближайшие — `spec_items.company_id` (поставщик позиции) и `service_operations.contractor_company_id` (подрядчик услуги), `.../00-…:157`.
3. Какая сумма считается «к оплате»: `priceOf().total` (цена заказчику, сейчас во всей воронке) или `priceOf().purchaseTotal` (закупка со скидкой студии, сейчас отбрасывается — `hooks/use-spec-builder.ts:1493`, `lib/spec/pricing.ts:45`)?
4. Нужны ли события истории по платежам? Новый `kind` требует миграции с переписыванием `spec_item_events_kind_check` (прецеденты `20260919/20/21`) и синхронной правки `SPEC_ITEM_EVENT_KINDS` (`lib/spec/history.ts:40-62`); либо платежи живут вне журнала.
5. Нужна ли группировка воронки по поставщикам (plan-факт по контрагентам)? Сейчас `procurement[s].items` — плоский список, поставщик есть в самой позиции (`lib/types.ts:179-181`), агрегатов по нему нет.
6. Считать ли `deliveredPct` по деньгам или по количеству — сейчас метрика по деньгам, подпись по количеству (`hooks/use-spec-builder.ts:1528`, `procure-modal.tsx:80`).
7. Должны ли платежи попадать в экспорт/PDF/публичную ссылку (`actions/spec-export.ts:97,268`, `lib/spec/pdf-document.tsx:326`) — это повлияет на выбор «карточка vs проектная сводка».
8. Роли: запись идёт через `canMutateRecord`/`can(ctx.role, ...)` (`actions/specifications.ts:58`, `actions/spec-item-files.ts:202`) — нужны ли отдельные права на «отметить оплату» для `viewer`/`member`.
