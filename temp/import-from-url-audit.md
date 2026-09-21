# Architectural Audit — "Import a material/product from a URL"

Read-only audit. No application file was modified. The only file created is this report.

---

## A. Current material architecture

### A.1 Data model

`materials` is the **library of reusable templates**. A material is *not* referenced from a
specification — it is **copied by value** into a `spec_items` row at the moment the user adds it
to a project (`actions/materials.ts:281-305`, `hooks/use-spec-builder.ts:806-883`). There is only
one link back: `spec_items.material_id`, kept for duplicate detection, not for live syncing.

`public.materials` (from `lib/supabase/database.types.ts:197-303`):

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | tenant key; **always** filtered in code |
| `created_by` | uuid null | drives per-record authorization |
| `name` | text NOT NULL | the only required user field |
| `category` | text NOT NULL (default) | **the spec section** — dictionary `spec_types` (Отделка, Мебель, …) |
| `product_type` | text null | **type inside the category** (Керамогранит, Ламинат, Обои…) |
| `brand` | text null | also doubles as the "manufacturer" filter facet |
| `article` | text null | |
| `unit` | text NOT NULL | free text, UI offers `UNIT_OPTIONS` |
| `price` | numeric NOT NULL | `0` means "price not specified" |
| `image_url` | text null | Supabase Storage public URL in practice |
| `product_url` | text null | already exists — the product page URL |
| `lead_time` | text null | present in DB + RPC, **not** in `materialSchema` or the material dialog |
| `attrs` | jsonb NOT NULL `'{}'` | flat `Record<string,string>` key→value characteristics |
| `notes`, `attachments`, `tags`, `product_description` | — | present in generated types, **zero references anywhere in code** (verified by grep) |
| `company_id` / `contact_id` | uuid null FK | supplier + manager |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | soft delete via `deleted_at` |

Important: `supabase/migrations/` contains **only** incremental migrations
(`20260903…` → `20260915`). The `create table public.materials` statement lives in the remote
project, not in this repo. `20260915_002_material_type_and_attrs.sql` is the only migration that
touches `materials` (adds `attrs`, comments `category`/`product_type`).

### A.2 Two-layer taxonomy (the part that matters most for a URL importer)

The codebase recently split one concept into two (`lib/constants.ts:273-552`):

* **`category`** = spec section. Closed-ish dictionary `SPEC_TYPES`/`TYPE_ORDER`
  (11 values, `lib/constants.ts:160-174`). Determines the spec group and the code prefix
  (`PREFIX_MAP`).
* **`product_type`** = material kind inside the category. **Open** dictionary — presets are
  suggestions only; `MaterialTypePicker` explicitly allows free text
  (`components/layout/material-type-picker.tsx:22-32`).

Attribute presets are therefore resolved by *(category, product_type)* with a category fallback:
`attrPresetsFor(category, materialType)` → `ATTR_PRESETS_BY_TYPE` ?? `ATTR_PRESETS[category]`
(`lib/constants.ts:539-547`).

### A.3 Layering

```
app/(protected)/[orgSlug]/materials/page.tsx   RSC — reads via lib/queries
  └─ MaterialsClient (client, "use client")     optimistic state + URL-driven dialogs
       ├─ MaterialDialog          create/edit form
       └─ AttachToProjectDialog   material → spec_items
lib/queries.ts            server reads   (requireOrgBySlug + createAdminClient)
lib/validations.ts        zod schemas  (shared client + server)
actions/materials.ts      "use server" mutations
lib/db/guard.ts           scoped() / assertCanMutate()
lib/permissions.ts        can() / canMutateRecord()
lib/auth/session.ts       requireOrgBySlug()
lib/supabase/admin.ts     createAdminClient()  ← the ONLY Supabase client in the app
```

**Every** DB access in the app goes through `createAdminClient()` (service-role key) and enforces
`org_id` in application code. There is **no** `@supabase/ssr`, no browser client, no anon-key
client, and no RLS-based authorization for `materials` (RLS policies exist only for
`spec_item_components` and `service_operations*`). Authorization is therefore **always** a
server-side obligation.

---

## B. Relevant files and their purposes

### Materials domain

| Path | Purpose |
|---|---|
| `lib/supabase/database.types.ts:197-303` | Generated `materials` Row/Insert/Update types |
| `lib/supabase/database.overrides.ts` | Hand-written types for RPCs not in generated output (`create_manual_spec_item`, `set_spec_item_code`, `accept_invite`) |
| `lib/supabase/admin.ts` | The single Supabase client factory (service role) |
| `lib/supabase/rpc.ts` | Typed `callRpc()` wrapper for override-declared RPCs |
| `lib/validations.ts:94-124` | `materialSchema` / `MaterialInput` — **the material draft contract** |
| `lib/validations.ts:283-418` | `manualSpecItemSchema` / `ManualSpecItemInput` — the *richer* spec-item draft (qty, discounts, leadTime, saveToLibrary) |
| `actions/materials.ts` | `upsertMaterial`, `deleteMaterial`, `addMaterialToProject`, `listMaterialProjectTargets`, `uploadMaterialImage` |
| `lib/queries.ts:93-142` | `MaterialListItem` + `toMaterialListItem` mapper |
| `lib/queries.ts:144-323` | `getMaterials`, `getMaterialsPage`, `getMaterialBrands`, `getMaterialById` |
| `lib/queries.ts:452-588` | `MaterialProjectTarget`, `getMaterialProjectTargets` |
| `lib/queries.ts:47-92` | `getSpecPickerData`, and `MATERIAL_LIST_SELECT` |
| `lib/spec/adapters.ts` | `toFormValues` (row → form) and `toListItem` (form → optimistic row) |
| `lib/constants.ts` | `TYPE_ORDER`/`SPEC_TYPES`, `PREFIX_MAP`, `UNIT_OPTIONS`, `LEAD_TIME_OPTIONS`, `ATTR_PRESETS`, `ATTR_PRESETS_BY_TYPE`, `TYPE_PRESETS`, `attrPresetsFor`, `typePresetsFor` |

### UI

| Path | Purpose |
|---|---|
| `app/(protected)/[orgSlug]/materials/page.tsx` | RSC page; header + `MaterialsCreateButton` + toolbar + client + pagination |
| `app/(protected)/[orgSlug]/materials/{layout,error}.tsx` | `PageContainer`; error boundary |
| `components/materials/materials-client.tsx` | Orchestrator: `useOptimistic`, dialog URL state, save/delete/attach handlers |
| `components/materials/material-dialog.tsx` | **The material create/edit dialog** — 552 lines, react-hook-form + zodResolver |
| `components/materials/materials-create-button.tsx` | Header entry point, opens `?action=create` shallow |
| `components/materials/materials-toolbar.tsx` | Search + filters + sort; `sm+`/`sm-` divergence |
| `components/materials/material-card.tsx` | Card + mobile row, edit/delete/attach menu |
| `components/materials/materials-skeleton.tsx` | Suspense fallback |
| `components/layout/material-type-picker.tsx` | Category-aware, free-text-allowing type combobox |
| `components/layout/attrs-editor.tsx` | Generic key→value editor, preset-driven, used by **both** dialogs |
| `components/layout/company-picker.tsx` | Supplier picker (+ inline company creation) |
| `components/ui/use-dialog-dismiss-guard.tsx` | "Unsaved changes" guard used by `MaterialDialog` |
| `hooks/use-dialog-url.ts` | URL-driven dialog state, `shallow: true` via `history.pushState` |
| `hooks/use-materials-url.ts` | Filter/sort/paging URL writer |
| `lib/materials/filters.ts` | `materialsFiltersSchema`, `parseMaterialsFilters`, `updateMaterialsSearchParams`, `MATERIALS_PAGE_SIZE` |

### Spec-builder (the other material entry path)

| Path | Purpose |
|---|---|
| `components/spec-builder/modals/manual-item-form.tsx` | Full manual position form (qty, discounts, lead time, save-to-library) |
| `hooks/use-spec-builder.ts:886-939` | `addManual` — client-generates `itemId` **and** `materialId`, then calls the RPC |
| `actions/specifications.ts:185-249` | `createManualSpecItem` — atomically inserts library material **and** spec item |
| `supabase/migrations/20260915_002_material_type_and_attrs.sql` | RPC `create_manual_spec_item` — inserts into `materials` + `spec_items` in one transaction |

### Infrastructure

`auth.config.ts` (route protection), `proxy.ts` (Next 16's renamed middleware),
`lib/auth.ts` (NextAuth v5), `lib/auth/session.ts` (`getSessionContext`/`requireOrgBySlug`),
`lib/db/guard.ts`, `lib/permissions.ts`, `lib/action-result.ts` (`ok`/`fail`/`ActionErrorCode`),
`lib/action-toast.ts` (`runAction`), `next.config.ts` (image `remotePatterns`, 8 MB action body),
`.env.local`.

---

## C. Existing material creation flow

### C.1 Library path (the one the feature should join)

1. **Entry point.** `MaterialsCreateButton` (`material-dialog.tsx` sibling) renders an `<a>` whose
   `href` is `?action=create`. `useDialogUrl("action", [], { shallow: true })` intercepts a plain
   left click and calls `window.history.pushState` — so the URL changes, `useSearchParams`
   updates, and **no RSC round-trip happens** (`hooks/use-dialog-url.ts:75-90`). Middle-click /
   no-JS still work because the real `href` is present.
2. **Dialog open state is derived, never stored.** `MaterialsClient` reads
   `searchParams.get("action")`; `isDialogOpen = action === "create" || Boolean(editingItem)`
   (`materials-client.tsx:129-135`).
3. **Defaults.** `MaterialDialog` initializes `useForm` with
   `category: TYPE_ORDER[0]`, `unit: "шт"`, `price: 0`, `attrs: {}`, everything else empty
   (`material-dialog.tsx:86-107`) and re-initializes on `[open, resetKey]` where
   `resetKey = materialToEdit?.id ?? null` (`:122-176`). The comment at `:109-121` explains why the
   effect must **not** depend on the `materialToEdit` object identity — the parent recreates it on
   every render. **This is a hard constraint for any "prefill from import" design.**
4. **Form fields.** image upload, `name`, `category` (native `<select>` over `TYPE_ORDER`),
   `product_type` (`MaterialTypePicker`), `brand`, `article`, `attrs` (`AttrsEditor`), `price`,
   `unit` (`Select` over `UNIT_OPTIONS`), `product_url`, supplier (`CompanyPicker`).
   Note: **`lead_time`, `notes`, `tags`, `product_description`, `attachments` are not editable
   here** even though `lead_time` exists in the DB.
5. **Supplier is deliberately held outside the form.** `supplier` state (`:132-142`) is the payload
   source of truth because `form.reset` used to wipe `company_id` (`:123-131`).
6. **Image upload.** `handleFile` → `FormData` → `uploadMaterialImage(orgSlug, fd)` server action →
   `form.setValue("image_url", res.url, { shouldDirty: true })` (`:203-222`). Upload is **immediate**
   and unconditional — the file lands in Storage *before* the record is saved.
7. **Submit.** `onSubmit` merges `supplier` + `materialToEdit?.id` into a `MaterialInput` and calls
   `onSave(payload)` — a **synchronous** prop, then closes the dialog (`:189-201`).
8. **Persistence.** `MaterialsClient.handleSave` (`:208-225`):
   ```ts
   startTransition(async () => {
     setOptimisticMaterials({ type: "save", payload: data });   // optimistic
     const res = await upsertMaterial(orgSlug, data);           // server action
     if (!res.success) toast.error(...); else toast.success(...);
   });
   ```
9. **`upsertMaterial`** (`actions/materials.ts:27-79`): `materialSchema.safeParse` → if `id`,
   `assertCanMutate(orgSlug, "materials", id)` then scoped `.update()`; else `scoped(orgSlug)` +
   `can(ctx.role, "record:create")` then `.insert({...fields, org_id, created_by})`.
   Returns the legacy `{ success, data?, error? }` shape (not `ActionResult`).
   Finally `revalidatePath('/${orgSlug}/materials')`.

### C.2 Spec-builder path (creates a material as a side-effect)

`ManualItemForm` → `addManual` (`hooks/use-spec-builder.ts:886-939`) generates `itemId` **and**
`materialId` client-side with `crypto.randomUUID()`, optimistically appends the item, then calls
`createManualSpecItem` → RPC `create_manual_spec_item`, which inserts into `materials` and
`spec_items` in one transaction with `p_save_to_library`. Rollback is client-side on failure
(`:930-934`). Deleted spec items are soft-deleted; a library material created this way is a
**full sibling** of the library path.

---

## D. Recommended integration points

### D.1 Entry point — extend the existing header, do not add a new route

`MaterialsCreateButton` currently renders exactly one button. The lowest-friction option that
preserves every existing convention:

* Add a second action next to "Добавить" in `PageHeader` (`materials/page.tsx:30-35`), e.g.
  `MaterialsImportButton`, that opens `?action=import` through the **same**
  `useDialogUrl("action", [], { shallow: true })`.
* `MaterialsClient` already switches on the `action` string; add `action === "import"` as a third
  state alongside `create` / `edit` / `to-project`. Do **not** add `useState` for open/closed —
  that would break deep-linking, Back-button closing, and the no-JS server render that
  `useDialogUrl`'s comment guarantees.
* Alternative (if a modal-in-modal is undesirable): a URL-import **step inside `MaterialDialog`**,
  i.e. `?action=create&import=1`, which adds a "Вставить ссылку" row above the image section. This
  reuses the form instance directly and avoids the prefill-plumbing problem in D.2 entirely — but
  it makes `MaterialDialog` (already 552 lines) bigger.

Recommendation: **a separate small `MaterialImportDialog` that produces a `MaterialInput` and hands
it to the existing `MaterialDialog` for review.** Rationale in D.2.

### D.2 The form to reuse

`components/materials/material-dialog.tsx` — unambiguously. It is the only form bound to
`materialSchema`, and it is already reached from two call sites (create, edit). No second material
form should be written.

**But its reset semantics are the integration hazard.** The form resets only when
`[open, resetKey]` changes, where `resetKey = materialToEdit?.id ?? null`, and `materialToEdit` is
rebuilt on every parent render by `toFormValues`. Therefore:

* Prefilling by passing a `materialToEdit`-shaped object **without an `id`** will silently collide:
  `resetKey` stays `null` while the object identity changes, so the effect at `:144-176` will
  re-run on random parent renders and clobber user edits. This is precisely the bug documented at
  `:109-121`.
* Two safe options:
  1. Move "import → review" **into** `MaterialDialog` as a first step of the `create` flow
     (single dialog, single `useForm` instance, no prefill contract needed).
  2. Or give the draft a stable `resetKey` — e.g. extend the reset effect to key off an explicit
     `draftKey` prop rather than `materialToEdit?.id`, and follow the `supplier` pattern
     (`:123-142`) for any field the importer must survive re-initialization. This is a genuine
     change to a component with a documented regression history and should be treated as such.

`ManualItemForm` (`components/spec-builder/modals/manual-item-form.tsx`) is the *richer* form
(qty, discounts, `leadTime`, `saveToLibrary`) but it is bound to `manualSpecItemSchema` and to a
`project`. It is **not** reusable for the library flow — importing into it would mean importing
into a *project*, which is a different feature.

### D.3 The action that persists the material

**`upsertMaterial(orgSlug, input)` in `actions/materials.ts`.** It is the only writer to
`materials` from the library, it already handles both insert and update, it validates with
`materialSchema`, and it already applies `record:create` / `assertCanMutate`. The importer must
**not** insert into `materials` itself.

Reuse `uploadMaterialImage(orgSlug, fd)` for the image (see D.5) rather than writing to Storage
directly — bucket name, path convention (`${orgId}/${uuid}.${ext}`), 5 MB cap and MIME check all
live there (`actions/materials.ts:367-403`).

### D.4 Types to reuse

| Reuse | Instead of inventing |
|---|---|
| `MaterialInput` / `materialSchema` (`lib/validations.ts:100-124`) | a new "imported material" type |
| `MaterialListItem` + `toListItem` (`lib/queries.ts:93`, `lib/spec/adapters.ts:27`) | a new list shape for optimistic insert |
| `toFormValues` (`lib/spec/adapters.ts:6`) | a second row→form mapper |
| `ActionResult` / `ok` / `fail` / `ActionErrorCode` (`lib/action-result.ts`) | ad-hoc `{success,error}` |
| `scoped()` / `assertCan` / `can(role,"record:create")` (`lib/db/guard.ts`, `lib/permissions.ts`) | inline session checks |
| `SpecType`, `TYPE_ORDER`, `UNIT_OPTIONS`, `attrPresetsFor`, `typePresetsFor` (`lib/constants.ts`) | duplicated dictionaries |
| `AttrsEditor` | a bespoke attribute grid |
| `useDialogUrl` / `useDialogDismissGuard` | local modal state |
| `runAction` + `toast` (`lib/action-toast.ts`) | bespoke toast plumbing |

The importer's extracted output should be shaped as a **partial `MaterialInput`** (the "draft"),
which is exactly the term used in the request. Add one new zod schema for the *importer's own*
inputs — the URL and the parsed payload — but the boundary type handed to the form must remain
`MaterialInput`.

### D.5 Common fields vs. category-specific fields

**Common (map 1:1 from a typical product page; also the fields the form renders):**

`name`, `brand`, `article`, `price`, `unit`, `product_url`, `image_url`, `company_id`
(supplier/manufacturer — resolvable against the already-loaded `companies` list),
`category` (must be *classified* into `TYPE_ORDER`), `product_type` (classified into
`TYPE_PRESETS[category]`).

**Category-specific:** everything inside **`attrs`**, plus `unit` in practice (m² for tile,
м.п. for moulding, шт for a chair).

`attrs` is the designated escape hatch: it is a flat `Record<string,string>`, presets come from
`attrPresetsFor(category, product_type)`, and `AttrsEditor` accepts arbitrary extra keys. So the
importer should emit **only** well-known common fields plus an `attrs` bag of whatever else it
extracted (формат, поверхность, цвет, мощность, цоколь, …), letting the existing preset machinery
and the user's review do the normalisation.

**Not `attrs`:** `lead_time` is a real column (and is used by the `create_manual_spec_item` RPC and
`LEAD_TIME_OPTIONS`) but is absent from `materialSchema`/`MaterialDialog`. Extending
`materialSchema` with `lead_time` is a schema change that also affects `upsertMaterial`'s
`fields` spread — decide deliberately (see G).

### D.6 Where to put the fetching/parsing code

Two shapes are available and both are precedented:

* **Server Action** (`actions/materials.ts` or a new `actions/material-import.ts`). Precedent:
  every mutation. Constraint: actions are `POST`-only, body cap 8 MB here
  (`next.config.ts:9-13`), and a slow upstream fetch occupies the action's duration.
* **Route Handler** (`app/api/...`). Precedent exists only for the public PDF route
  (`app/api/spec-pdf/[token]/route.tsx`), which sets `export const runtime = "nodejs"` and
  `export const dynamic = "force-dynamic"`. Note `proxy.ts`'s matcher **excludes `api`**, so a new
  route handler gets **no middleware/auth protection** — it must call `requireOrgBySlug()` itself.

Egress details verified in the bundled Next 16 docs (required by `AGENTS.md`):

* `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`: *"By default,
  `fetch` requests are not cached."* This project does **not** set `cacheComponents: true`, so a
  plain `fetch` for a third-party page is uncached and correct with no options.
* `.../01-getting-started/15-route-handlers.md`: *"Route Handlers are not cached by default."*
* `.../02-guides/server-actions.md:82-83`: CSRF origin check; *"Body size limit. Action requests are
  capped at 1MB by default"* — already raised to 8 MB here.
* `.../02-guides/server-actions.md:132-152`: `updateTag` / `revalidateTag` / `revalidatePath` /
  `refresh`. `revalidatePath` (what the codebase already uses) is the right choice — it re-renders
  the current route in the action's own response.
* No SSRF-specific guidance exists in the bundled docs (grep for `SSRF` in `01-app/**` returns
  nothing). Outbound-URL safety must be designed by us, not inherited.

No HTML parsing library is installed. A `package.json`/`package-lock.json` scan for
`cheerio|jsdom|linkedom|node-html-parser|htmlparser2|parse5|playwright|puppeteer|axios|openai|readability`
finds **nothing**; only `undici` appears, as a transitive `@supabase/*`/`npm` dependency. So the
parser is a **new dependency** (or a hand-rolled regex/JSON-LD reader).

### D.7 Image handling — the concrete conflict

`next.config.ts:4-7` allows `next/image` remote sources from **exactly one** pattern:
`{ protocol: "https", hostname: "*.supabase.co" }`. `MaterialDialog` and `MaterialCard` render
`image_url` through `next/image`. Therefore an imported image URL pointing at
`https://vendor.example/img.jpg` will **throw at render time**.

Three resolvable options:

1. **Mirror on import** (recommended): server action fetches the remote image, validates
   content-type and size, uploads through the existing `${orgId}/${uuid}.${ext}` convention into
   the `material-images` bucket, and stores the Supabase public URL. Zero config change, keeps the
   single-origin guarantee, survives vendor link rot, and reuses `uploadMaterialImage`'s bucket
   contract. Needs its own SSRF guards (D.8).
2. Leave the remote URL in `image_url` and keep it out of `next/image` (plain `<img>`) — pollutes
   the invariant that every rendered image is same-origin.
3. Widen `remotePatterns` — impossible to do safely for arbitrary vendors; would either be a
   wildcard (`hostname: "**"`) or per-vendor config. Not recommended.

Also note: `uploadMaterialImage` takes a `FormData` `File`. A server-side re-host helper should be
factored so both paths share the bucket/MIME/size rules instead of duplicating them.

### D.8 Where authorization must be added

Follow the app's real rule: **authorization is server-side code, not RLS.**
`requireOrgBySlug(orgSlug)` (or `scoped(orgSlug)`) at the top of every new server entry point;
`can(ctx.role, "record:create")` before importing. If a route handler is used, it gets no
middleware (matcher excludes `api`) — it must authenticate explicitly.

The import itself is a classic SSRF surface and has **no precedent in this codebase**. It needs,
at minimum: scheme allow-list (`https:`; probably reject `http:`), DNS resolution + private/
loopback/link-local/CGNAT range rejection (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`,
`169.254/16`, `::1`, `fc00::/7`), **post-redirect** re-validation of the final URL, a hard
response-size cap, a request timeout, a content-type allow-list, and `Accept`/`User-Agent` headers.
There is no rate-limiting infrastructure anywhere in the repo (grep for `rateLimit` → nothing), so
per-user throttling would also be new.

---

## E. Potential conflicts with the existing architecture

1. **`materials` insert vs. the RPC.** A library-only import should call `upsertMaterial`. But if
   the user later wants "import straight into a project", the *only* atomic path is
   `create_manual_spec_item`, which requires a `p_code` allocated by `nextCodesFrom` and a
   `p_project_id`. Two different persistence paths exist today; the importer must pick one
   explicitly rather than growing a third.
2. **`MaterialDialog` reset effect.** Passing a prefilled draft into `MaterialDialog` risks
   re-triggering the documented `form.reset` regression (`material-dialog.tsx:109-176`). Any
   prefill plumbing must respect `resetKey`.
3. **`next/image` host allow-list** (D.7) — hard runtime failure for third-party images.
4. **`lead_time` is in the DB and the RPC but not in `materialSchema`/`MaterialDialog`.** A product
   page almost always yields a lead time; without a schema change it has nowhere to land except
   `attrs`.
5. **`attrs` is flat `Record<string,string>` with a `.max(500)` value cap**
   (`lib/validations.ts:120`). Long descriptions scraped from a page will be rejected by
   validation. There is no `notes`/`product_description` in the schema at all, despite the columns
   existing.
6. **`price` semantics.** `0` = "not specified" is load-bearing: `addMaterialToProject` sets
   `status: material.price > 0 ? "picked" : "draft"` (`actions/materials.ts:298`) and `MaterialCard`
   renders "Цена не указана" at `0`. A page that quotes "цена по запросу" must map to `0`, not to
   a scraped placeholder.
7. **Currency and unit negotiation.** `price` is implicitly RUB; `UNIT_OPTIONS` is a fixed Russian
   list (`м²`, `м.п.`, `рулон`, …) while `unit` is free text in the DB. A non-Russian vendor page
   needs FX conversion and unit translation — neither exists.
8. **Action return-shape inconsistency.** `upsertMaterial`/`deleteMaterial`/`uploadMaterialImage`
   return the legacy `{success, data?, error?}`; newer actions return `ActionResult<T>` via
   `ok`/`fail` with an `ActionErrorCode`. New code should use `ActionResult` (the Next 16 docs also
   advise constraining action return values), but `upsertMaterial` is a legacy exception that
   cannot be changed without touching its existing caller.
9. **Slow synchronous actions.** All existing actions are fast DB calls. An import action performs
   network I/O with an unpredictable duration; there is no `maxDuration` set anywhere
   (`dynamic = "force-dynamic"` appears only on the share page and the PDF route) and no job/queue
   infrastructure. Client-side UX must handle a multi-second `startTransition`.
10. **No tests, no test config — `npm test` currently FAILS.** `package.json` declares
    `"test": "vitest run"` and devDependencies include `vitest@5`, `happy-dom`,
    `@testing-library/react`, `@testing-library/user-event`, `@vitejs/plugin-react`,
    `@playwright/test` — but `tests/` is **empty**, there is **no** `vitest.config.*` / setup file,
    and no `*.test.*` / `*.spec.*` file anywhere outside `node_modules`. Verified by running it:
    ```
    RUN  v5.0.1 E:/repositories/2026/SpecTrack/spectrack2depp
    No test files found, exiting with code 1
    include: **/*.{test,spec}.?(c|m)[jt]s?(x)
    exclude:  **/node_modules/**, **/.git/**
    ```
    Vitest 5 falls back to its default `include` glob, so colocated tests *would* be picked up with
    no config. There is nothing to extend; the parser will be the first thing in the repo with no
    harness, and `@vitejs/plugin-react` + `happy-dom` being pre-installed suggests a config was
    planned and never committed.
11. **Redirect/`revalidatePath` contract.** `upsertMaterial` revalidates
    `/${orgSlug}/materials`. An import flow that also changes `companies` (if it creates a supplier)
    would need the contacts paths revalidated too — see `getCounterparties`.
12. **i18n / locale.** All UI strings and error messages are Russian and hardcoded. Scraped
    English/German field names must be mapped to Russian dictionary values (`TYPE_ORDER`,
    `TYPE_PRESETS`, `ATTR_PRESETS_BY_TYPE`) — the dictionaries are Russian-only literals.
13. **`proxy.ts` excludes `api`** from the auth matcher, so an `app/api/import/route.ts` would be
    publicly reachable by design unless it self-authenticates.

---

## F. What should NOT be changed

* **Do not introduce a second Supabase client.** `createAdminClient()` is the single client; there
  is no `@supabase/ssr` usage and no RLS backstop for `materials`.
* **Do not move authorization into the database or the client.** Keep `scoped()` /
  `assertCanMutate()` / `can()` as the enforcement point.
* **Do not fork `materialSchema`.** Extend it (or reuse it as-is) so the form, the action and the
  DB stay in step.
* **Do not write a second material form.** Reuse `MaterialDialog`; if prefill is needed, fix the
  `resetKey` contract deliberately rather than by adding a parallel component.
* **Do not duplicate `AttrsEditor`, `MaterialTypePicker`, `CompanyPicker`, or the
  `attrs` preset tables** in `lib/constants.ts`.
* **Do not bypass `upsertMaterial`** for library persistence, and do not bypass
  `uploadMaterialImage`'s bucket/path/MIME/size rules for images.
* **Do not add local modal `useState`** where `useDialogUrl` is the convention — it would break
  deep-links, the Back button, and the no-JS server render.
* **Do not change `next.config.ts` `images.remotePatterns`** to accommodate arbitrary vendor hosts.
* **Do not alter `materials.category` semantics.** It is the spec section, shared verbatim with
  `spec_items.type`; `PREFIX_MAP` and spec grouping depend on it.
* **Do not touch the `create_manual_spec_item` RPC** for this feature. Its signature was just
  cleaned up (three historical overloads dropped in `20260915_002`) and it is `security definer`
  with hand-maintained `grant`s; adding parameters is a multi-step migration.
* **Do not remove or repurpose the legacy `materials.attachments` / `notes` / `tags` /
  `product_description` columns** — they are unused but present in generated types; repurposing
  them silently would be a hidden schema contract.
* **Do not regenerate `lib/supabase/database.types.ts` casually** — `lib/supabase/database.overrides.ts`
  exists because the generator produces union/overload noise for the hand-authored RPCs.

---

## G. Questions and uncertainties to resolve before implementation

**Scope & UX**

1. Is this **library-only** ("Import → review in the material form → save to library"), or must it
   also offer "import directly into a project specification"? The latter changes which action is
   reused (D.3) and whether a code must be allocated.
2. Where exactly should the entry point live? A second button in the materials `PageHeader`
   (`?action=import`), or a step inside the existing create dialog (`?action=create&import=1`)?
   The answer determines whether D.2's `resetKey` change is needed at all.
3. After a successful import, should the user be able to edit the *raw* extracted payload
   (a preview/JSON view) or only the mapped form fields?

**Fetching**

4. Is a **new npm dependency** (e.g. `cheerio`/`linkedom` + a JSON-LD reader) acceptable, or must
   extraction be dependency-free? This is the first HTML parser in the project.
5. Which extraction strategies do we support, in priority order: `application/ld+json`
   (`schema.org/Product`), OpenGraph/microdata, site-specific adapters, generic heuristics?
   Anything needing JS execution (Playwright in a browserless context) is a much larger change —
   confirm it is out of scope.
6. Must we handle bot-blocked pages, consent walls, and `403`/`429`? What is the user-facing
   message when extraction fails or returns nothing usable?
7. What are the SSRF policy specifics — allow `http:` as well as `https:`? Block which ranges?
   Follow redirects (how many, re-validated)? Max response bytes? Request timeout budget?
   Does this project need per-user rate limiting, and if so, where would state live (there is no
   cache/queue/Redis in this app)?
8. Should the fetching/parsing run in a **Server Action** or a **Route Handler**? (Route handlers
   here get no middleware auth, and the action body limit is already 8 MB for uploads.)
9. Is there a serverless/platform function timeout we must respect, and do we need
   `export const maxDuration`?

**Mapping**

10. **Category classification.** `category` is a closed 11-value Russian dictionary and drives spec
    grouping and code prefixes. How is a scraped page mapped to it — keyword heuristics, an LLM
    call, or always a default like `Отделка` with the user correcting it?
    (Note: the codebase has **no** LLM/AI dependency today; adding one is a significant decision.)
11. **Type classification.** Same question for `product_type` (open dictionary, presets per
    category). Do we map into `TYPE_PRESETS[category]` or leave it free text?
12. **Attrs vocabulary.** Do we emit preset keys from `ATTR_PRESETS_BY_TYPE` only, or allow
    arbitrary scraped keys? If arbitrary, the 500-char value cap in `materialSchema.attrs` will
    reject long text — do we truncate, drop, or raise the cap?
13. **`lead_time`.** Do we add `lead_time` to `materialSchema` + `MaterialDialog` (so scraped lead
    times are editable), or fold it into `attrs`? Adding it touches `upsertMaterial`'s `fields`
    spread and `toFormValues`/`toListItem`.
14. **Price.** Implicit currency is RUB. Do we convert, and with what rate source? What happens with
    "price on request", ranges, or per-unit-of-measure prices ("за м²")? Confirm `0` for unknown.
15. **Unit.** How do we map vendor units onto `UNIT_OPTIONS`? Fall back to free text, or to `шт`?
16. **Brand vs. supplier.** Product pages give a manufacturer brand; `materials.company_id` is a
    supplier from the org's `companies`. Do we auto-match the brand against `companies` (via
    `getCounterparties`, already loaded on the materials page), offer to create a company through
    `CompanyPicker`, or leave supplier empty?
17. **Image.** Which option in D.7 — mirror into `material-images` (recommended) or store the
    remote URL? If mirroring: do we take the first image, the OpenGraph image, or let the user pick
    from a gallery? Image download shares the SSRF surface and needs the same guards.
18. **Deduplication.** `getMaterialProjectTargets` uses `material_id` (exact) and `article`
    heuristic for project duplicates. Should the importer warn on an existing library material with
    the same `product_url` or `article`, and offer "update existing"? There is no unique constraint
    on either.

**Persistence & review**

19. Confirm the review step must show the **real** `MaterialDialog` (per the request), meaning the
    extracted draft is never written to the DB until the user presses Save — i.e. **no draft row,
    no `deleted_at` trick, no session storage** in Supabase. (Recommended; matches "only then save
    it to Supabase".)
20. `product_url` should presumably be set to the imported URL automatically. Confirm, and confirm
    whether the URL field stays editable.
21. On success, should we return the new material and let `MaterialsClient` run its existing
    optimistic `save` path (which calls `toListItem`), or simply rely on `revalidatePath`? The
    existing flow does both.
22. Should the import be retryable/idempotent from the UI if the user double-submits?

**Process**

23. **Testing.** `npm test` currently runs Vitest against zero test files and there is no
    `vitest.config.*`. Should the importer be the occasion to establish the test harness (config +
    `happy-dom` + Testing Library are already installed), and if so, what is the expected
    convention — colocated `*.test.ts` next to `lib/`, or a `tests/` tree (the empty directory
    suggests the latter was intended)?
24. Are there environment variables or secrets the importer needs (proxy, API key for an extraction
    service, `NEXT_PUBLIC_APP_URL`)? There is no `.env.example`; `.env.local` is the only env file.
    Its names are: `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`, `AUTH_SECRET`, `BETTER_AUTH_SECRET`,
    `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
    `RESEND_API_KEY`, `EMAIL_FROM`, `DEV_EMAIL_INBOX`, `AUTH_URL`, `AUTH_GOOGLE_ID`,
    `AUTH_GOOGLE_SECRET`. Actual `process.env.*` references in source are only:
    `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
    `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `DEV_EMAIL_INBOX`, `NODE_ENV`
    — i.e. `NEXTAUTH_URL`, `AUTH_SECRET`, `BETTER_AUTH_SECRET` and
    `NEXT_PUBLIC_SUPABASE_ANON_KEY` are **present but unreferenced** (the anon key is dead weight;
    nothing uses it). All are read with `!` non-null assertions and never validated at boot, so a
    missing var fails late and obscurely — relevant if the importer adds new required config.
25. Deployment target? Several answers above (SSRF egress rules, timeouts, `maxDuration`, IP
    allow-listing) depend on where this runs.

---

## Implementation notes (added after the LLM stage)

Config introduced by the DeepSeek integration (server-only, never `NEXT_PUBLIC_`):

| Variable | Required | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | no | Bearer key. Absent → the LLM layer is skipped and the pipeline still returns a draft from the deterministic layer. |
| `DEEPSEEK_MODEL` | no | Overrides the default `deepseek-flash`. |
| `DEEPSEEK_THINKING` | no | `1` enables the model's thinking mode. Off by default (unnecessary for extraction; `temperature` has no effect in that mode). |
| `JINA_API_KEY` | no | Optional; Jina Reader works without it. |

`.env.local` still has none of these set, and there is still no `.env.example`.

Two deviations from the original audit, both forced and documented in code:

1. **`tests/` vs colocated tests.** `npm test` was failing (`No test files found`) and `tests/` is
   excluded from `tsconfig.json`, so tests are colocated as `lib/material-import/*.test.ts`. A
   `vitest.config.*` could not be loaded in this environment (Vite shells out and hit `spawn EPERM`),
   so aliases are avoided and the pool/env are set on the command line in `package.json`.
2. **`lib/constants.ts` imports.** Two import lines were changed from `@/lib/…` to relative paths so
   the test graph can resolve them without a Vitest alias. This matches the existing precedent in
   `lib/spec/pdf-fonts.ts`.

