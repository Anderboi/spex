# 04. Модель доступа и RLS — факты для проектирования таблиц платежей (план и факт)

Этап 1. В репозитории изменён только этот файл; миграции не запускались, пакеты не устанавливались.
Пометки: **[Ф]** проверено в файлах · **[Ж]** из уже полученных живых данных
(`.scratch/material-payments/research/00-postgrest-schema-raw.txt`) · **[П]** предположение.

## Краткое резюме

1. Премисса «better-auth» не подтверждается: проект на **next-auth v5 (Auth.js)**, `session: { strategy:
   "jwt" }`; `users/sessions/accounts/verification_tokens` — адаптерная схема Auth.js (`package.json:32`,
   `lib/auth.ts:87-89`, `auth.config.ts:1`, `actions/auth.ts:270`) **[Ф]**.
2. Личность в RLS определяется **только `auth.uid()`**; `current_setting(...)`, `request.jwt.claims`,
   `auth.jwt()` в миграциях не встречаются ни разу **[Ф]**.
3. Helper-предикат ровно один — `public.is_org_member(uuid)`, и он **не определён** в репозитории (только
   `revoke`/`grant`, `20260916_001:355-359`) **[Ф]**. Остальные предикаты — инлайновые `exists (…)`.
4. Приложение **всегда ходит service-role клиентом** (`lib/supabase/admin.ts:4-13`), значит `auth.uid()` в
   рабочем трафике **всегда NULL** и RLS приложению не преграда — это записано в комментариях миграций
   (`20260916_001:20-33`, `20260918_001:19-25`, `20260927_001:16-23`) **[Ф]**.
5. Supabase Auth сессии приложение не создаёт: `@supabase/ssr` объявлен (`package.json:22`), но не
   импортируется нигде **[Ф]**; единственный anon-клиент — в интеграционном тесте
   (`integration/spec-item-files.int.test.ts:94-96`), который проверяет именно отказ RLS (`505-534`).
6. Форм предиката три: (а) денормализованный `org_id` + членство; (б) то же + сверка `org_id` с
   родительским `spec_items.org_id`; (в) через связующую таблицу или путь Storage. Формы «через
   `projects.organization_id`» в RLS **нет ни одной** **[Ф]**.
7. Роль проверяется только у `organizations`, `organization_members`, `organization_invites` (owner/admin)
   и точечно у `spec_item_comments`/`storage.objects` (`role <> 'viewer'`). У `spec_item_components`,
   `service_operations`, `service_operation_items` роли нет — только членство **[Ф]**.
8. Права в приложении держат `requireOrgBySlug` + `can()`/`canMutateRecord()` (`lib/permissions.ts:105-137`,
   `lib/auth/session.ts:153-165`); функций `requireRole`/`assertMember` **нет** **[Ф]**. У `spec_items` нет
   `created_by`, поэтому запись позиций проверяется по автору **проекта** (`actions/specifications.ts:55-68`).
9. Мягкое удаление есть у `spec_items`, `projects`, `materials`, `spec_item_comments`, `spec_item_files`, но
   `deleteProject` удаляет проект физически (`actions/projects.ts:109-113`), а
   `service_operations.project_id` каскадится (`20260907_001:29-30`) — каскад уничтожил бы историю.
   Прецедент защиты: `deleteServiceOperation` снимает снимок связок **до** каскада
   (`actions/service-operations.ts:823-836`) **[Ф]**.
10. Предварительно для платежей: якорь — `org_id + spec_item_id` с предикатом как у
    `spec_item_comments`/`spec_item_files`; `project_id` — денормализация для выборок, не якорь доверия; FK
    на `spec_items` не `cascade`; кто вправе вносить факт — **прецедента нет** (§7).

---

## 1. Роли и членство (`20260916_001_organization_roles_owner_admin_member.sql`)

**Роли.** Enum `public.org_role` = `owner | admin | member | viewer`: «пересоздавать тип НЕ нужно, 'owner' в
нём уже присутствует» (`:7-8`) **[Ф]**; живая схема — `role: public.org_role, NOT NULL,
enum:owner|admin|member|viewer` (`00-postgrest-schema-raw.txt:83`) **[Ж]**; та же четвёрка и ранги в TS
(`lib/permissions.ts:33-40,53-58`). *Правка к заданию: ролей четыре — `viewer` существует и участвует в
политиках.*

**Таблицы и ограничения.**
* `organization_members`: PK `(org_id, user_id)`, `role` типа `org_role`, FK на `organizations(id)
  ON DELETE CASCADE` (`:9-10`; `00-postgrest-schema-raw.txt:80-84`) **[Ф][Ж]**.
* `organization_invites.role` — `text` + `CHECK (role IN ('admin','member'))`: «пригласить сразу owner'ом
  через существующую систему нельзя» (`:11-12`); в TS `INVITE_ROLES = ["admin","member"]`
  (`lib/permissions.ts:259-265`), zod `z.enum(["admin","member"])` (`actions/teams.ts:34`) **[Ф]**.
* `organizations.created_by` — не источник истины: «у части организаций он NULL, а владелец при этом есть.
  Источник истины — `organization_members.role = 'owner'`» (`:13-15`) **[Ф]**.
* Инвариант «ровно один owner» держит **схема**: `create unique index if not exists
  organization_members_single_owner_idx on public.organization_members (org_id) where role = 'owner';`
  (`:169-173`) **[Ф]**. Перед ним три `do $$`-блока: запрет ролей вне owner/admin/member (`41-57`);
  детерминированный выбор владельца — `created_by`-участник → единственный участник → самый ранний, при
  неоднозначности падение («случайного владельца не назначаем», `68-152`); проверка результата (`155-167`).

**Функции и триггеры.** Триггеров нет ни одного: grep `create trigger` по всем `supabase/migrations/*.sql`
даёт 0 совпадений **[Ф]**; 20260918_001:25 формулирует это как правило — триггер не смог бы определить
актора при `auth.uid() = NULL`. Владение держат два `security definer` RPC (`set search_path = public`):
* `update_organization_name(p_org_id, p_actor_id, p_name)` (`:179-232`): актор обязателен →
  `UNAUTHENTICATED` (`194-196`); «если функция вызвана под настоящей Supabase-сессией, подменять актора
  нельзя»: `if auth.uid() is not null and auth.uid() <> p_actor_id then raise exception 'ACTOR_MISMATCH'`
  (`199-201`); роль из БД → `NOT_A_MEMBER` / `FORBIDDEN`, если не `owner` (`210-219`).
* `transfer_organization_ownership(p_org_id, p_actor_id, p_target_name)` (`:241-332`): `perform 1 … for
  update` по составу (`274-277`); роль актора (`279-288`); получатель ищется **по имени**, «чтобы клиент не
  мог подсунуть произвольный user_id» (`290-304`); `TARGET_NOT_FOUND`/`TARGET_AMBIGUOUS`/`ALREADY_OWNER`
  (`306-315`); старый owner → `admin`, новый → `owner` (`320-326`).
* Права: `revoke all … from public, anon, authenticated` + `grant execute … to service_role` для обоих RPC
  (`345-353`); `is_org_member` — наоборот, `grant` для `authenticated`/`service_role` (`355-359`);
  легаси-перегрузка `create_organization(uuid, text)` (была открыта `anon`) удалена (`361-372`). Полные тела
  RPC — в приложении.

---

## 2. Как RLS определяет пользователя

* **`auth.uid()` — единственный механизм** **[Ф]**: `20260906_002:25,41,57,67,83`;
  `20260907_001:94,109,124,133,148,167,183,200,210,227`;
  `20260918_001:193,221,238,243,260,265,271,276,288,293`; `20260927_001:151,244,259,277`;
  `20260916_001:420,428,463,467,487,501,515`. JWT-claims и `current_setting` — 0 совпадений.
* **Предикаты:** `public.is_org_member(uuid)` — `using (public.is_org_member(id))` (`20260916_001:409`) и
  `using (public.is_org_member(org_id))` (`441`); тела функции в репозитории нет. Прочие `security definer`
  функции (`update_organization_name`, `transfer_organization_ownership`, `create_manual_spec_item` —
  `20260916_001:186,248`, `20260915_002:84`) — это RPC, а не предикаты RLS.
* **Двухшаговая модель актора** (образец для новых операций): «приложение использует next-auth + собственные
  сессии, а не Supabase Auth, поэтому `auth.uid()` внутри вызовов через service role всегда NULL. Отсюда
  двухшаговая модель: функция дополнительно требует, чтобы переданный актор совпадал с `auth.uid()`, ЕСЛИ uid
  есть … и всегда проверяет membership и роль по БД» (`20260916_001:27-33`) **[Ф]**.
* Идентичность приложения: JWT next-auth + чтение `organization_members` сервером — `token.id` → сессия
  (`lib/auth.ts:89,145-166`), `getSessionContext()` читает `users.active_org_id` и `organization_members`
  (`lib/auth/session.ts:56-76`) **[Ф]**.
* Ни одна политика не использует claims и Postgres-роли вне `anon/authenticated/service_role` — только
  `exists` по `organization_members`. Полные тексты всех политик — в приложении.

---

## 3. Форма предиката владения: от строки до организации

**(а) Денормализованный `org_id` + членство, без обращения к родителю** — `service_operations`
(`20260907_001:90-97`):
`exists (select 1 from public.organization_members m where m.user_id = auth.uid() and m.org_id =
service_operations.org_id)`.

**(б) `org_id` + сверка с родительским `spec_items`** — якорь на `spec_item_id` (`20260906_002:20-29`; то же
у `spec_item_events` `20260918_001:188-197`, `spec_item_comments` `216-225`, `spec_item_files`
`20260927_001:146-155`):
```sql
exists (select 1 from public.organization_members m
          join public.spec_items s on s.id = spec_item_components.spec_item_id
         where m.user_id = auth.uid()
           and m.org_id = spec_item_components.org_id
           and s.org_id = spec_item_components.org_id)
```
Мотив: «внешний ключ не гарантирует "одна организация на всю цепочку", поэтому принадлежность к позиции
проверяется явно» (`20260906_002:5-7`).

**(в) Через связующую таблицу, без своего `org_id`** — `service_operation_items` идёт
`operation_id → service_operations.org_id` (`20260907_001:162-170`), а на запись сверяет ещё организацию и
проект позиции: `… and si.org_id = so.org_id and si.project_id = so.project_id` (`177-188`) **[Ф]**.

**(г) Helper-функция** — только `is_org_member` для `organizations`/`organization_members`
(`20260916_001:409,441`); тело неизвестно **[Ф]**.

**(д) `project_id → projects.organization_id` в RLS не используется нигде.** `service_operations` смотрит
`project_id` **только в `with check`** (`20260907_001:108-112,132-136`), а `spec_item_files` в политике
`project_id` игнорирует, хотя колонка есть (`20260927_001:38,146-155`). Цепочка живёт только в коде:
`actions/specifications.ts:45-51`, `actions/spec-components.ts:107-113`,
`actions/service-operations.ts:98-104` **[Ф]**.

**(е) Автор, а не организация** — `author_id = auth.uid()` (`20260918_001:238,260,271,288`) **[Ф]**.

**(ж) По пути объекта Storage** — `m.org_id::text = (storage.foldername(name))[1]`
(`20260927_001:245,260,278`); первый сегмент пути — `orgId` по конвенции (`221-226`) **[Ф]**.

**Индексы под предикаты** **[Ф]**: `spec_item_components` — `(spec_item_id, position)`,
`(parent_component_id, position)`, `(ref_spec_item_id) where not null` (`20260905_001:58-65`);
`service_operations` — `(org_id)`, `(project_id)` (`20260907_001:46-50`); `service_operation_items` — PK
`(operation_id, spec_item_id)` + `(spec_item_id)` (`57-58,71-72`); `spec_item_events` —
`(spec_item_id, created_at desc)`, `(org_id)` (`20260918_001:90-96`); `spec_item_comments` —
`(spec_item_id, created_at desc)`, `(spec_item_id, root_id, created_at)`, `(parent_id, created_at)`
(`146-155`, индекса по `org_id` нет); `spec_item_files` — частичный `(spec_item_id, created_at desc, id desc)
where deleted_at is null`, `(org_id)`, `(project_id)` (`20260927_001:101-114`). Все предикаты покрыты: join
идёт по `spec_item_id`, а `organization_members` имеет PK `(org_id, user_id)` — оба сравнения на равенство
(`00-postgrest-schema-raw.txt:81-82`) **[Ж]**. Неизвестно локально: индексы `spec_items(org_id)`,
`spec_items(project_id)`, `projects(org_id)`; из миграций известен только `spec_items_parent_id_idx`
(`20260903_002:10-11`).

Заготовка на будущее: «подзапрос читает `public.spec_items` напрямую. Это работает, пока у `spec_items` не
включён RLS (сейчас политик у неё нет). Если RLS на `spec_items` появится, политики ниже нужно переписать»
(`20260918_001:173-176`) **[Ф]**.

---

## 4. Разделение прав по ролям

### 4.1. В политиках RLS **[Ф]**

| Таблица | select | insert | update | delete | роль проверяется |
| --- | --- | --- | --- | --- | --- |
| `spec_item_components` | ✔ | ✔ | ✔ | ✔ | нет — только членство (`20260906_002:16-87`) |
| `service_operations` | ✔ | ✔ | ✔ | ✔ | нет (`20260907_001:85-151`) |
| `service_operation_items` | ✔ | ✔ | ✔ | ✔ | нет (`20260907_001:157-229`) |
| `spec_item_events` | ✔ | — | — | — | «INSERT/UPDATE/DELETE политик НЕТ — и это осознанное решение» (`20260918_001:199-204`) |
| `spec_item_comments` | ✔ | ✔ | ✔ | ✔ | insert: `role <> 'viewer'`; update/delete: **только автор** (`20260918_001:232-297`) |
| `spec_item_files` | ✔ | — | — | — | «Запись … политиками НЕ разрешена намеренно» (`20260927_001:133-137`) |
| `storage.objects` (bucket `spec-item-files`) | ✔ | ✔ | — | ✔ | insert/delete: `role <> 'viewer'` (`20260927_001:234-281`) |
| `organizations` | ✔ | — | ✔ | **нет** | update: только `owner` (`20260916_001:404-434`) |
| `organization_members` | ✔ | ✔ | **нет** | ✔ | insert: `owner/admin`; delete: себя нельзя, `owner` — любого, `admin` — только `member` (`436-473`) |
| `organization_invites` | ✔ | ✔ | — | ✔ | только `owner/admin` (`478-518`) |
| `users` | — | — | — | — | только `to service_role using(true) with check(true)` (`388-402`); прежняя `for all to public using (true)` удалена (`383-386`) |

Ключевые формулировки: запрет наблюдателя — `author_id = auth.uid() and exists (… m.role <> 'viewer' …)`
(`20260918_001:237-248`), мотив — «наблюдатель (viewer) прав записи не имеет по матрице `lib/permissions.ts`
(граница `record:create`, минимум member)» (`227-231`); «Правка и удаление — только автору. Матрица прав на
комментарии ещё не определена (роли admin/owner сюда намеренно не заложены) … будет пересмотрена вместе с
permissions» (`250-253`); иерархия ролей внутри условия — только у `organization_members_delete_manager`
(`m.role = 'owner' or (m.role = 'admin' and organization_members.role = 'member')`, `464-472`); «UPDATE у
`organization_members` без политики … Только RPC» (`475-476`); «DELETE у `organizations` намеренно без
политики» (`433-434`).

### 4.2. В серверном коде **[Ф]**

* `requireRole` / `assertMember` / `assertRole` — grep по репозиторию даёт 0 совпадений. Роль проверяют
  `can(role, permission)` и `canMutateRecord(...)` (`lib/permissions.ts:117-137`).
* Гейт: `requireOrgBySlug(slug)` — сессия + slug среди организаций пользователя, иначе `notFound()`
  (`lib/auth/session.ts:153-165`); `requireOrg()` (`146-151`); `requireAuth()` (`139-143`).
* `lib/db/guard.ts`: `scoped()` — «orgId ВСЕГДА из сессии, никогда из аргументов» (`9-12`);
  `assertCanMutate()` проверяет `org_id` **и** право менять запись (`25-54`); `assertCan` (`56-61`).
  `OwnedTable = "projects" | "materials" | "companies" | "contacts"` (`6`) — `spec_items` там нет, потому что
  у позиции **нет `created_by`** (`00-postgrest-schema-raw.txt:245-285` **[Ж]**,
  `lib/supabase/database.types.ts:1231-1273` **[Ф]**).
* Поэтому запись позиций и всего, что от них зависит, проверяется **по автору проекта**:
  `canMutateRecord({role, userId, createdBy: project.created_by})` — `actions/specifications.ts:55-68`,
  `actions/spec-components.ts:102-117`, `actions/service-operations.ts:95-117`.
* Точечные проверки: `actions/materials.ts:70,224-230`; `actions/projects.ts:62,99,134`;
  `actions/contacts.ts:69,160,278`; `actions/spec-comments.ts:92`; `actions/spec-item-files.ts:202,292`;
  `actions/material-import.ts:104`; `actions/teams.ts:48,171,297`; `actions/organization.ts:140,181,396-399`.
* Матрица `MIN_ROLE` (`lib/permissions.ts:105-115`): `organization:update|delete|transfer` → owner;
  `member:invite|update|remove` → admin; `record:create`, `record:update:own` → member;
  `record:mutate:any` → admin. Про `can()`: «UI-гейт и ПРЕДВАРИТЕЛЬНАЯ проверка … не является механизмом
  безопасности: каждый server action обязан повторить проверку у себя» (`27-31`).
* **Service-role клиент — во всех actions без исключения** (128 вхождений `createAdminClient` в
  `actions/*.ts`), то есть «RLS обходит» (`20260916_001:21-22,377-381`; `20260918_001:19-21`;
  `20260927_001:16-18`). Практический смысл: проверка в action — единственный реальный барьер, RLS — второй
  контур на случай прямого Data API.

---

## 5. Практика удаления

**5.1. FK-поведение из миграций [Ф].** `cascade`: `spec_item_components.spec_item_id` и
`.parent_component_id` (`20260905_001:35-40`), `service_operations.project_id` (`20260907_001:28-30`),
`service_operation_items.operation_id` и `.spec_item_id` (`59-64`), `spec_item_events.spec_item_id`
(`20260918_001:53-55`), `spec_item_comments.spec_item_id` и `.parent_id` (`126-133`),
`spec_item_files.project_id` и `.spec_item_id` (`20260927_001:68-78`), `organization_members.org_id`
(`20260916_001:10`). `set null`: `service_operations.contractor_company_id` (`31-33`),
`spec_item_events.actor_id` (`56-58`), `spec_item_comments.author_id` (`134-136`),
`spec_item_files.uploaded_by` (`81-83`). **`restrict`**: `spec_item_components.ref_spec_item_id`
(`20260905_001:41-43`), `spec_items.parent_id` (`20260903_002:5-8`). NO ACTION (без `on delete`):
`spec_item_components.org_id` (`20260905_001:33-34`), `service_operations.org_id` (`20260907_001:26-27`).
Живая схема (комментарий, помеченный как проверенный по фактической схеме — `actions/organization.ts:12-21`):
`public_links.org_id`, `service_operations.org_id`, `spec_item_components.org_id` → **NO ACTION**;
`spec_item_components.ref_spec_item_id` → **RESTRICT**.

**5.2. Мягкое удаление.** `deleted_at` есть у `spec_items` (`00-postgrest-schema-raw.txt:273`), `projects`
(`131`), `materials` (`61`), `spec_item_comments` (`181`), `spec_item_files` (`222`) **[Ж]**. Нет — у
`spec_item_components`, `spec_item_events` (append-only), `service_operations`, `service_operation_items`,
`spec_item_variants`; в TS это зафиксировано прямо: «Удаление физическое: у `spec_item_variants` нет
`deleted_at`» (`lib/spec/history.ts:873`), то же про `spec_item_components` (`lib/spec/history.ts:1037`).
Мягко удаляют: позиции — `deleteSpecItems` (`actions/specifications.ts:973-978`), возврат —
`restoreSpecItems` (`1000-1029`); материалы — `deleteMaterial` (`actions/materials.ts:87-105`, комментарий
«материал может стоять в спецификациях сданных проектов»); комментарии — `lib/spec/comment-mutate.ts:288`;
файлы — `lib/spec/spec-item-files.ts:637`.

**5.3. Где удаление физическое — и что это значит.** **Проект** удаляется физически, несмотря на
`deleted_at`: `deleteProject` → `from("projects").delete()` (`actions/projects.ts:109-113`), право — через
`canMutateRecord` (`99-104`) **[Ф]**. Для платежей это ключевой риск: `service_operations.project_id`
каскадится, то есть строки исчезают молча. Организация удаляется тоже физически, но управляемым порядком:
сначала `public_links`, `service_operations`, `spec_item_components` (у них нет каскада), затем `spec_items`
«волнами» по `parent_id`, затем `organizations` — «остальное уезжает каскадом»
(`actions/organization.ts:33-37,46-92,334-360`); Storage чистится best-effort до строк (`410-411`).
Удаление операции — физическое, со снимком связок **до** каскада: «Сначала связки — чтобы удаление работало
и на БД без каскада … Заодно это и снимок списка позиций: `.select()` возвращает удалённые строки, а после
удаления операции каскад уничтожил бы их молча» (`actions/service-operations.ts:823-836`, сам DELETE —
`839-850`) **[Ф]** — готовый прецедент обращения с теряемыми данными. Append-only по замыслу:
`spec_item_events` — «строки не обновляются и не удаляются» (`20260918_001:98-99`), «журнал append-only и
пишется только серверным кодом» (`199-204`); тот же смысл у `spec_item_files` (`20260927_001:133-137`).

---

## 6. Клиенты Supabase

* **Единственный клиент приложения — service role:** `createAdminClient()` с
  `process.env.SUPABASE_SERVICE_ROLE_KEY!` (`lib/supabase/admin.ts:4-13`). Используется во всех
  `actions/*.ts` (128 вхождений), в `lib/auth.ts:16,106` (**вход и Google-линковка**),
  `lib/auth/session.ts:62`, `lib/tokens.ts:37`, `lib/db/guard.ts:11` **[Ф]**. Второй service-role клиент —
  на уровне модуля: `lib/tokens.ts:5-8`.
* `lib/supabase/rpc.ts` — обёртка над `supabase.rpc()` с типами из `lib/supabase/database.overrides.ts`
  (`lib/supabase/rpc.ts:4-17`); клиент передаётся снаружи, то есть снова service role.
* **Anon/browser-клиента в коде приложения нет:** `createBrowserClient`/`createServerClient` — 0
  совпадений; `@supabase/ssr` в зависимостях (`package.json:22`), но не импортируется **[Ф]**.
* **Что это значит для RLS.** RLS не рабочий механизм доступа: приложение всегда service role,
  `auth.uid()` = NULL, роль `authenticated` в трафике не появляется. Проверяется ровно одним способом —
  anon-клиентом без токена: «anon без токена не читает строки (политика выдана только authenticated)»
  (`integration/spec-item-files.int.test.ts:505-509`), «anon не может вставить строку (write-политик нет по
  замыслу)» (`511-524`), «anon не может загрузить объект в bucket» (`526-534`); политики для
  `authenticated` **не покрыты ни одним тестом** **[Ф]**. Вывод: политика новой таблицы платежей — второй
  контур, который в текущей архитектуре никто не исполняет; реальный доступ определяют server actions и
  `org_id` из сессии. Политику всё равно надо писать (прецедент и требование миграций), но она не заменяет
  проверку в action.

---

## 7. Предварительная рекомендация (без окончательных решений)

**7.1. Какой предикат повторять.** Ближайший и самый свежий прецедент — форма (б): `org_id` строки + сверка
с `spec_items.org_id`, как у `spec_item_comments` (`20260918_001:216-248`) и `spec_item_files`
(`20260927_001:146-155`). Она честно отвечает «к какой организации относится строка», не доверяя
денормализованному `org_id` на слово, и совпадает с проверками в коде (`actions/spec-item-files.ts:88-94`,
`lib/spec/spec-item-files.ts:282-299`). Форма (а) (`service_operations`) короче, но верит `org_id` строки.

**7.2. `spec_item_id`, `project_id` или оба.** `spec_item_id` — обязательная привязка и **якорь доступа**
(как у comments/events/files). `org_id` — денормализован, `not null`, в политике сверяется с
`spec_items.org_id` (FK этого не гарантирует — `20260906_002:5-7`). `project_id` —
**денормализация для выборок и агрегатов, не якорь доверия**: ровно так он у `spec_item_files` (колонка
есть — `20260927_001:38`, в политике не участвует — `146-155`) и у `service_operations` (в политике — только
`with check`, `20260907_001:108-112`); он нужен, потому что бюджет/план-факт считаются на уровне проекта
(`lib/spec/project-budget.ts`), а FK даёт индекс и читаемый каскад. Если `project_id` всё же делается
якорём, придётся вводить форму `project_id → projects.org_id`, которой в существующих политиках нет ни одной
(§3, д).

**7.3. Кто вправе вносить фактические оплаты.** Прецедента ровно на «деньги» нет — это главный пробел.
Ближайшие аналоги: `spec_item_comments` insert — **любой член, кроме `viewer`**, update/delete — **только
автор** (`20260918_001:232-297`), причём роли admin/owner там «намеренно не заложены … будет пересмотрена
вместе с permissions» (`250-253`); `spec_item_files` upload/delete — `can(role, "record:create")`, то есть
**member и выше**, авторство (`uploaded_by`) дополнительных прав не даёт, и это объяснено: «роль "автор
файла" в этом проекте нигде не даёт дополнительных прав (у комментариев — даёт, поэтому там своё правило)»
(`actions/spec-item-files.ts:42-58,202,292`); `service_operations` — единственная существующая «денежная»
сущность — пишется по `canMutateRecord` от автора проекта: автор проекта или admin+
(`actions/service-operations.ts:95-117`), а RLS-политика роли не проверяет вовсе (`20260907_001:85-151`);
owner/admin появляются только там, где меняются **права людей** (invites, роли, удаление организации,
переименование) — `lib/permissions.ts:105-115`, `20260916_001:404-518`.

Итог: по существующей модели **member вправе писать факт не меньше, чем owner/admin**, если следовать
прецеденту `record:create`. Правило «факт оплаты — только owner/admin» — это **новое право** (например
`payment:write`), которого в матрице нет; вводить его молча нельзя (ср. осознанно отсутствующее
`link:create`, `lib/permissions.ts:19-25`). Отдельно: прецедент комментариев («автор правит своё») к деньгам
подходит плохо — «свой» факт не основание для правки после подтверждения; ближе по духу append-only
`spec_item_events` (пишет только сервер, `20260918_001:199-204`) и files (write-политик нет,
`20260927_001:133-137`).

**7.4. Удаление.** Риск прямой: `service_operations.project_id → projects on delete cascade`
(`20260907_001:29-30`) + физическое удаление проекта (`actions/projects.ts:109-113`) = тихая потеря строк.
Предложение (гипотеза, не найденный прецедент): FK на `spec_items` — `restrict` или `set null` и
`deleted_at` по образцу `spec_item_files`, а не `cascade`; `project_id` — без `cascade` либо с обязательным
снимком до удаления, как в `deleteServiceOperation` (`actions/service-operations.ts:823-836`).

**7.5. Индексы и инварианты.** Понадобится минимум `(spec_item_id, …)` и `(org_id)` — паттерн
`spec_item_files` (`20260927_001:101-114`) и `spec_item_events` (`20260918_001:90-96`). Контракт «миграция ↔
код» в проекте закрепляют тестом, читающим SQL-файл (`lib/spec/history.test.ts:40-90`,
`lib/spec/file-content.test.ts:38`) — так же можно закрепить форму политики платежей.

**7.6. Чего не хватает для окончательного ответа** — политики базовых таблиц; тело `is_org_member`; реальное
FK-поведение (код хеджирует: «чтобы удаление работало и на БД без каскада»,
`actions/service-operations.ts:823-824`); наличие `spec_items.created_by`; индексы по `org_id` у базовых
таблиц; включён ли RLS на `organizations`/`organization_members` — миграция 20260916_001 создаёт там
политики, но `enable row level security` **не делает**, а без него политики инертны **[Ф]**. Точные
запросы — ниже.

---

## Приложение. Полные тексты политик и функций-предикатов

Тексты условий дословные; `[П]`/`P1…P11` — ссылки на дословно приведённые ниже блоки предикатов (не
сокращение логики). `is_org_member(uuid)` в репозитории отсутствует — его текста здесь нет.

### `20260906_002` — `spec_item_components` (RLS включён, `:13`)

```sql
-- P1 = exists (select 1 from public.organization_members m
--               join public.spec_items s on s.id = spec_item_components.spec_item_id
--              where m.user_id = auth.uid() and m.org_id = spec_item_components.org_id
--                and s.org_id = spec_item_components.org_id)                       -- :20-29
create policy "spec_item_components_select_own_org" on public.spec_item_components
  for select to authenticated using (P1);                                          -- :16-29
create policy "spec_item_components_insert_own_org" on public.spec_item_components
  for insert to authenticated with check (P1);                                     -- :32-45
create policy "spec_item_components_update_own_org" on public.spec_item_components
  for update to authenticated using (P1) with check (P1);                          -- :48-71
create policy "spec_item_components_delete_own_org" on public.spec_item_components
  for delete to authenticated using (P1);                                          -- :74-87
```

### `20260907_001` — `service_operations` (RLS `:83`), `service_operation_items` (RLS `:153`)

```sql
-- P2 = exists (select 1 from public.organization_members m where m.user_id = auth.uid()
--              and m.org_id = service_operations.org_id)                            -- :90-97
-- P3 = exists (select 1 from public.organization_members m
--               join public.projects p on p.id = service_operations.project_id
--              where m.user_id = auth.uid() and m.org_id = service_operations.org_id
--                and p.org_id = service_operations.org_id)                          -- :108-112
create policy "service_operations_select_own_org" on public.service_operations
  for select to authenticated using (P2);                                          -- :86-97
create policy "service_operations_insert_own_org" on public.service_operations
  for insert to authenticated with check (P3);                                     -- :100-113
create policy "service_operations_update_own_org" on public.service_operations
  for update to authenticated using (P2) with check (P3);                          -- :116-137
create policy "service_operations_delete_own_org" on public.service_operations
  for delete to authenticated using (P2);                                          -- :140-151
-- P4 = exists (select 1 from public.organization_members m
--               join public.service_operations so on so.id = service_operation_items.operation_id
--              where m.user_id = auth.uid() and m.org_id = so.org_id)                -- :162-170
-- P5 = то же, что P4, плюс join public.spec_items si on si.id = service_operation_items.spec_item_id
--      и условия si.org_id = so.org_id and si.project_id = so.project_id            -- :177-188
create policy "service_operation_items_select_own_org" on public.service_operation_items
  for select to authenticated using (P4);                                          -- :158-170
create policy "service_operation_items_insert_own_org" on public.service_operation_items
  for insert to authenticated with check (P5);                                     -- :173-188
create policy "service_operation_items_update_own_org" on public.service_operation_items
  for update to authenticated using (P4) with check (P5);                          -- :191-215
create policy "service_operation_items_delete_own_org" on public.service_operation_items
  for delete to authenticated using (P4);                                          -- :218-229
```

### `20260918_001` — `spec_item_events` (RLS `:180`), `spec_item_comments` (RLS `:208`)

```sql
-- P6 = exists (select 1 from public.organization_members m
--               join public.spec_items s on s.id = spec_item_events.spec_item_id
--              where m.user_id = auth.uid() and m.org_id = spec_item_events.org_id
--                and s.org_id = spec_item_events.org_id)                            -- :188-197
create policy "spec_item_events_select_own_org" on public.spec_item_events
  for select to authenticated using (P6);   -- единственная; write-политик нет (:199-204)
-- P7 = как P6, с spec_item_comments вместо spec_item_events                           -- :216-225
create policy "spec_item_comments_select_own_org" on public.spec_item_comments
  for select to authenticated using (P7);
create policy "spec_item_comments_insert_member" on public.spec_item_comments
  for insert to authenticated
  with check (author_id = auth.uid()
    and exists (select 1 from public.organization_members m
                  join public.spec_items s on s.id = spec_item_comments.spec_item_id
                 where m.user_id = auth.uid() and m.role <> 'viewer'
                   and m.org_id = spec_item_comments.org_id
                   and s.org_id = spec_item_comments.org_id));                     -- :233-248
-- P8 = author_id = auth.uid() and P7                                                -- :259-269
create policy "spec_item_comments_update_author" on public.spec_item_comments
  for update to authenticated using (P8) with check (P8);                          -- :255-280
create policy "spec_item_comments_delete_author" on public.spec_item_comments
  for delete to authenticated using (P8);                                          -- :283-297
```

### `20260927_001` — `spec_item_files` (RLS `:139`) и `storage.objects`

```sql
-- P9 = exists (select 1 from public.organization_members m
--               join public.spec_items s on s.id = spec_item_files.spec_item_id
--              where m.user_id = auth.uid() and m.org_id = spec_item_files.org_id
--                and s.org_id = spec_item_files.org_id)                             -- :146-155
create policy "spec_item_files_select_own_org" on public.spec_item_files
  for select to authenticated using (P9);   -- единственная; write-политик нет (:133-137)
-- P10 = bucket_id = 'spec-item-files' and exists (select 1 from public.organization_members m
--          where m.user_id = auth.uid() and m.org_id::text = (storage.foldername(name))[1])
-- P11 = P10 and m.role <> 'viewer'
create policy "spec_item_files_objects_select_own_org" on storage.objects
  for select to authenticated using (P10);                                         -- :235-247
create policy "spec_item_files_objects_insert_own_org" on storage.objects
  for insert to authenticated with check (P11);                                    -- :250-265
create policy "spec_item_files_objects_delete_own_org" on storage.objects
  for delete to authenticated using (P11);                                         -- :268-281
```

### `20260916_001` — организации, участники, приглашения, users (полные тексты)

```sql
-- :395-401 (в do-блоке; :386 удалена прежняя "Service role access for users" —
--          она была for all to public using (true))
create policy "users_service_role_all" on public.users
  for all to service_role using (true) with check (true);                          -- :395-401
-- R = exists (select 1 from public.organization_members m where m.org_id = organizations.id
--              and m.user_id = auth.uid() and m.role = 'owner')
create policy "organizations_select_own" on public.organizations
  for select to authenticated using (public.is_org_member(id));                    -- :405-409
create policy "organizations_update_owner" on public.organizations
  for update to authenticated using (R) with check (R);                            -- :412-431
create policy "organization_members_select_own_org" on public.organization_members
  for select to authenticated using (public.is_org_member(org_id));                -- :437-441
create policy "organization_members_insert_manager" on public.organization_members
  for insert to authenticated
  with check (exists (select 1 from public.organization_members m
                       where m.org_id = organization_members.org_id
                         and m.user_id = auth.uid() and m.role in ('owner','admin'))); -- :444-455
create policy "organization_members_delete_manager" on public.organization_members
  for delete to authenticated
  using (user_id <> auth.uid()
    and exists (select 1 from public.organization_members m
                 where m.org_id = organization_members.org_id and m.user_id = auth.uid()
                   and (m.role = 'owner'
                        or (m.role = 'admin' and organization_members.role = 'member')))); -- :458-473
-- Q = exists (select 1 from public.organization_members m
--              where m.org_id = organization_invites.org_id
--                and m.user_id = auth.uid() and m.role in ('owner','admin'))
create policy "organization_invites_select_manager" on public.organization_invites
  for select to authenticated using (Q);                                           -- :479-490
create policy "organization_invites_insert_manager" on public.organization_invites
  for insert to authenticated with check (Q);                                      -- :493-504
create policy "organization_invites_delete_manager" on public.organization_invites
  for delete to authenticated using (Q);                                           -- :507-518
```

### RPC, проверяющие роль

Это не предикаты RLS, а `security definer` RPC с `set search_path = public`; полные тела —
`20260916_001:179-232` (`update_organization_name`) и `:241-332` (`transfer_organization_ownership`),
разбор построчно — в §1. Порядок проверок, общий для обоих: `p_actor_id is null` → `UNAUTHENTICATED`;
`auth.uid() is not null and auth.uid() <> p_actor_id` → `ACTOR_MISMATCH`; роль из
`organization_members` по `(p_org_id, p_actor_id)` → `NOT_A_MEMBER`, затем `v_role <> 'owner'` →
`FORBIDDEN`. В передаче владения дополнительно: `perform 1 … for update` по составу организации,
поиск получателя по `u.name`/`u.email` (не по переданному id), `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS` /
`ALREADY_OWNER`, затем `owner → admin` у актора и `→ owner` у получателя.

---

## Что добрать из БД

Read-only запросы к живой схеме (проект `dybltbdrxwjdfegkonzx`, `package.json:13`). Заготовка уже есть:
`temp/introspect.sql` + `temp/db-introspect.mjs` → `.scratch/material-payments/research/01-catalog.json`
(нужен `SUPABASE_ACCESS_TOKEN` в `.env.local`; исключает `slugify`/`unique_org_slug`, не собирает
`routine_privileges`).

**1. Где вообще включён RLS и какие есть политики.** Базовые таблицы, политик которых локально не видно:
`spec_items`, `projects`, `materials`, `organizations`, `organization_members`, `organization_invites`,
`users`, `sessions`, `accounts`, `companies`, `contacts`, `public_links`, `project_services`,
`project_service_items`. Ключевой вопрос: включён ли RLS на `organizations`/`organization_members` —
миграция 20260916_001 создаёт там политики, но `enable row level security` **не делает**, а без него
политики инертны; плюс есть ли write-политики у `spec_items`/`projects`/`materials`.
```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1;
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3;
```

**2. Тело и права `is_org_member`** — единственный предикат-хелпер; важно, `security definer` ли он (иначе
RLS на `organization_members` даёт рекурсию или пустой результат), и не осталось ли `grant execute` для
`anon` где-то ещё.
```sql
select p.proname, pg_get_function_arguments(p.oid) args, pg_get_function_result(p.oid) result, p.prosecdef, p.provolatile, p.proconfig, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_org_member','create_organization','ensure_personal_org','accept_invite','set_spec_item_code','create_manual_spec_item','slugify','unique_org_slug');
select routine_name, grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' order by 1,2;
```

**3. Реальное FK-поведение** — сейчас известно только из комментария `actions/organization.ts:12-21`, а код
хеджирует «на БД без каскада» (`actions/service-operations.ts:823-824`); для платежей это решающий факт.
`confdeltype`: `a` NO ACTION, `r` RESTRICT, `c` CASCADE, `n` SET NULL, `d` SET DEFAULT. Нужны все FK на
`organizations(id)`, `projects(id)`, `spec_items(id)`, `users(id)`.
```sql
select con.conrelid::regclass::text child, con.conname, con.confrelid::regclass::text parent, con.confdeltype, pg_get_constraintdef(con.oid) def from pg_constraint con join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public' and con.contype = 'f' order by 1,2;
```

**4. Ограничения и уникальность базовых таблиц** — PK/unique у `organization_members`; CHECK на
`organization_invites.role`; unique `(org_id,email)` у `organization_invites` (на него опирается
`upsert(..., { onConflict: "org_id,email" })`, `actions/teams.ts:81-93`); unique `organizations.slug`;
unique-ограничение `spec_items`, из-за которого `restoreSpecItems` ловит `23505`
(`actions/specifications.ts:1032-1034`).
```sql
select con.conrelid::regclass::text tbl, con.conname, con.contype, pg_get_constraintdef(con.oid) def from pg_constraint con join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public' order by 1,2;
```

**5. Индексы** — прежде всего `spec_items(org_id)`, `spec_items(project_id)`, `spec_items(deleted_at)`,
`projects(org_id)`, `projects(deleted_at)`, `materials(org_id, deleted_at)`, `organization_members(user_id)`,
`organization_invites(org_id)`, `organizations(slug)`.
```sql
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1,2;
```

**6. Колонки, от которых зависит выбор предиката** — критично: есть ли у `spec_items` колонка `created_by`
(в живой PostgREST-схеме её **нет**, `00-postgrest-schema-raw.txt:245-285`; отсутствие подтверждает
`OwnedTable` без `spec_items`, `lib/db/guard.ts:6`) и есть ли `deleted_at` у `projects`/`materials`.
```sql
select table_name, column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name in ('spec_items','spec_item_files','service_operations','projects','materials','organizations','organization_members','organization_invites','users','project_services','project_service_items','public_links') order by 1, ordinal_position;
```

**7. Enum'ы** — подтвердить `org_role` = `owner|admin|member|viewer` и `spec_status`.
```sql
select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' order by 1, e.enumsortorder;
```

**8. Buckets и Storage-политики** — в репозитории политик `material-images`/`project-images`/
`company-images` нет (`temp/files-audit.md:118-123,278-286`); нужно понять, не окажется ли у платежей
«сосед» с иной моделью доступа.
```sql
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by 1;
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1;
```
