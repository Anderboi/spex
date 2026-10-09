# Client-bundle & hydration audit — SpecTrack (Next.js 16.2.10, App Router, React 19.2.4)

**Scope:** client/server boundary on `app/(protected)/[orgSlug]/**` + `app/page.tsx`, heavy-library reachability,
barrel/tree-shaking risk, `next/font` payload, root `SessionProvider` cost, hydration hazards.
**Method:** read-only source tracing from `app/layout.tsx`; plus measurement against the production artefacts that
happened to be on disk in `.next/` at audit time (a Turbopack build/dev tree — see *Measurement caveat*).

## Measurement caveat (read this first)

`.next/` in this workspace is **actively being written by a running Turbopack process**. I measured the artefact
tree once and recorded numbers, but `BUILD_ID`, `app-build-manifest.json` and the `[orgSlug]` `page_client-reference-manifest.js`
files were truncated/removed while I worked, so **I could not re-verify those byte counts** and they may be stale.
Confidence per number is marked below. Everything that is a *reachability* claim is verified from source
(`file:line`) and does not depend on the build tree.

Measured once, minified, uncompressed, from `.next/static/chunks/*.js`:

| Chunk | Size | Libraries identified by source-string probes | Confidence |
|---|---|---|---|
| `3-q4qjff0q96q.js` | **902.4 KB** | `ReactCrop` (29 refs, `ReactCrop__crop-selection`), `useFormContext`, base-ui modules (`Menu`/`Dialog`/`Select`/`Drawer`/`Slider`/`ScrollArea`/`Tooltip`/`Tabs`/`Popover`/`Collapsible`/`Checkbox`/`Radio`/`Toast`/`Avatar`), spec-builder UI strings (`Обрез`, `Помещен`) | medium (chunk re-read at 909,309 B later; sizes moved) |
| `33r8patqwaux0.js` / `1hx7o62stc9at.js` | **297 KB each** (two variants) | `zod_brand`, `ZodError` | medium |
| `4464v34jfm7wf.js` / `2-z-hlmty13o5.js` | **78.5 KB each** (two variants) | `cmdk` | medium |
| `1rxzp4lfg6kfx.js` | **47.5 KB** | `sonner` + `next-auth` | medium |
| `14mrh2-p_w84d.js` | 53.4 KB | no probe hit (Next.js runtime/router) | medium |
| `00e-pp_ru88cj.js`, `1hntsjteb7lod.js` | 46.7 KB each | `lucide-react`, `clsx` | medium |

Route totals I recorded (client chunks referenced by the route's `page_client-reference-manifest.js`), before the
manifests were truncated:

| Route | Total referenced client chunks |
|---|---|
| `app/(protected)/[orgSlug]/projects` (list) | 856.6 KB across 17 chunks |
| `app/(protected)/[orgSlug]/projects/[id]` | **1 860.3 KB across 20 chunks** |
| `app/(protected)/[orgSlug]/materials` | 990.0 KB across 19 chunks |
| `app/(protected)/[orgSlug]/contacts` | 893.0 KB across 18 chunks |

I also decoded the `clientModules` map of `page_client-reference-manifest.js` from that tree, which gave the
**client entry-point sets** below — that is the single most valuable artefact and it is reproduced as evidence
for Task 1.

---

## Findings ranked by estimated saving

### 1. `zod` + `react-hook-form` + Radix form stack (≈297 KB chunk) is in the initial bundle of the projects **list** route — HIGH
**Mechanism.** `projects/page.tsx:3` renders `<CreateProjectDialog>` in the server-rendered header. That component
statically imports the whole create form:

```
app/(protected)/[orgSlug]/projects/page.tsx:3   import { CreateProjectDialog } from "@/components/project/create-project-dialog";
components/project/create-project-dialog.tsx:9  import { ProjectDialog } from "./project-dialog";
components/project/project-dialog.tsx:10        import { useForm, SubmitHandler } from "react-hook-form";
components/project/project-dialog.tsx:11        import { zodResolver } from "@hookform/resolvers/zod";
components/project/project-dialog.tsx:14        import { projectSchema, ProjectInput } from "@/lib/validations";
lib/validations.ts:1                            import { z } from "zod";
components/project/project-dialog.tsx:25-32     import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
components/ui/form.tsx:4-5                      import * as LabelPrimitive from "@radix-ui/react-label"; import { Slot } from "@radix-ui/react-slot";
components/project/project-dialog.tsx:46        import { RoomsEditor } from "@/components/spec-builder/layout/rooms-editor";
components/project/project-dialog.tsx:47        import { ScrollArea } from "@/components/ui/scroll-area";
```

`ProjectDialog` renders `null`/closed markup until `?action=create` is in the URL, yet 100 % of its code ships.
Confirmed by chunk attribution: the 297 KB zod chunk is reachable from `create-project-dialog.tsx` (module id
13170) via the manifest's `chunks` list.

**Est. saving: ~297 KB minified (≈95–105 KB brotli) on `/…/projects`, and it is the same chunk the `[id]` and
materials routes carry.**

**Minimal fix.** `components/project/create-project-dialog.tsx:9` — replace the static import with a lazy one and
render it only when the URL dialog is open:

```tsx
const ProjectDialog = dynamic(() => import("./project-dialog").then(m => m.ProjectDialog), { ssr: false });
// ...
{isOpen && <ProjectDialog orgSlug={orgSlug} open onClose={closeDialog} onSuccess={...} />}
```

`isOpen` already comes from `useDialogUrl("action")` (line 17), so no state change is needed. Same pattern applies
to `EditProjectDialog` / `ProjectActions` on `projects/[id]/page.tsx:90`.

---

### 2. `react-image-crop` (+ CSS) and the whole spec-builder modal stack are in the initial bundle of `/…/projects/[id]` — HIGH
**Mechanism.** The detail page's only client entry is `SpecBuilder`, a client component that statically imports
everything it might ever open:

```
app/(protected)/[orgSlug]/projects/[id]/page.tsx:1  import SpecBuilder from "@/components/spec-builder/spec-builder";
components/spec-builder/spec-builder.tsx:19         import { DetailModal } from "./modals/spec-mat-detail-modal";
components/spec-builder/spec-builder.tsx:33         import AddModalForm from "./modals/add-spec-mat-modal-form";
components/spec-builder/spec-builder.tsx:34         import { ProcureModal } from "./modals/procure-modal";
components/spec-builder/spec-builder.tsx:35         import { SpecSummary } from "./summary/spec-summary";
components/spec-builder/spec-builder.tsx:42         import { ServiceOperationModal } from "./modals/service-operation-modal";
components/spec-builder/modals/spec-mat-detail-modal.tsx:21  import DetailsHeader from "./details-header";
components/spec-builder/modals/details-header.tsx:4          import { MaterialImageField } from "@/components/layout/material-image-field";
components/layout/material-image-field.tsx:9                 import { ImageCropModal } from './image-crop-modal';
components/layout/image-crop-modal.tsx:4-9                   import ReactCrop, { centerCrop, makeAspectCrop, ... } from "react-image-crop";
components/layout/image-crop-modal.tsx:10                    import "react-image-crop/dist/ReactCrop.css";
```

Evidence this lands in the browser: `ReactCrop` / `ReactCrop__crop-selection` appear in
`.next/static/chunks/3-q4qjff0q96q.js` (902.4 KB, the single dominant chunk of the 1 860 KB route total), together
with base-ui `Menu`/`Dialog`/`Select`/`Drawer`/`Slider`/`Tabs`/`Tooltip`/`Popover`/`Collapsible`/`Checkbox`/`Radio`/`Toast`.
`react-image-crop`'s own `dist/index.js` is only **19.7 KB** (measured), so the library itself is not the problem —
it is a *marker* proving the modal stack is in the initial bundle.

**Est. saving: not attributable to `react-image-crop` alone (≈20 KB + 4.8 KB CSS, measured). The actionable target
is the modal/summary subtree behind it — that is where the 902 KB chunk's spec-builder half lives. Unmeasured
individually because the chunk was being rewritten while I probed it.**

**Minimal fix.** `components/spec-builder/spec-builder.tsx:19,33,34,35,42` — make the five modal/summary imports
`next/dynamic` with `ssr: false`, and gate them on the URL dialog state the component already reads via
`useDialogUrl` (line 9) / `useSpecBuilder`:

```tsx
const DetailModal = dynamic(() => import("./modals/spec-mat-detail-modal").then(m => m.DetailModal), { ssr: false });
```
Additionally, `components/layout/material-image-field.tsx:9` should lazy-load `ImageCropModal` (it is only needed
after the user picks a file), which removes `react-image-crop` + its CSS from every spec-builder page.

---

### 3. `cmdk` (78.5 KB chunk) reachable from the spec detail modal and from materials/contacts — MEDIUM
**Mechanism.** `components/ui/command.tsx:4` statically imports `cmdk`. It is pulled in through three pickers that
are statically imported by components on common routes:

```
components/spec-builder/modals/spec-mat-detail-modal.tsx:14  import { CompanyDialog } from "@/components/contacts/company-dialog";
components/contacts/company-dialog.tsx:37                    import { CategoryMultiSelect } from "../layout/category-multiselect";
components/layout/category-multiselect.tsx:6                 ... from "@/components/ui/command"      (cmdk)
components/layout/company-picker.tsx:19                      ... from "@/components/ui/command"      (cmdk)
components/spec-builder/modals/spec-components-section.tsx:52 import { CompanyPicker } from "@/components/layout/company-picker";
components/spec-builder/layout/supplier-picker.tsx:27        ... from "@/components/ui/command"      (cmdk)
components/materials/material-dialog.tsx:44,47               MaterialTypePicker + CompanyPicker      (cmdk)
components/materials/attach-to-project-dialog.tsx:30         ... from "@/components/ui/command"      (cmdk)
components/spec-builder/layout/spec-item-ref-picker.tsx:17   ... from "@/components/ui/command"      (cmdk)
```

Two distinct 78.5 KB chunks containing `cmdk` were present in the build (`4464v34jfm7wf.js`, `2-z-hlmty13o5.js`).
**Not reachable from the projects *list* route** — I traced `create-project-dialog` → `project-dialog` → its imports
and none reach `command.tsx`. It *is* reachable from `projects/[id]`, `materials` and `contacts`.

**Est. saving: ~78.5 KB minified on `/…/projects/[id]`, `/…/materials`, `/…/contacts`.**

**Minimal fix.** Lazily load the pickers, not `cmdk` itself:
`components/layout/company-picker.tsx:6-11` and `components/layout/material-type-picker.tsx:6-11` wrap
`Command*` in `dynamic(..., { ssr: false })`, or (better) lazy-load `CompanyDialog`/`CategoryMultiSelect` from
`components/contacts/company-dialog.tsx:37` and `components/layout/category-multiselect.tsx:6`, since the picker
popover itself is only opened on click.

---

### 4. `SessionProvider` at the root costs every route and provides nothing — HIGH (cheapest fix)
**Mechanism.** `app/layout.tsx:6` imports `SessionProvider` from `next-auth/react` and `app/layout.tsx:57-67`
wraps the entire app. `next-auth/react`'s provider runs `useSession`, which:
1. on mount fetches `/api/auth/session` (an extra RTT on **every** route, including `/login`, `/share/spec/[token]`, `/`),
2. makes every descendant a client-boundary consumer of a React context.

**Is `useSession` actually used? No.** Exhaustive search for `useSession` across `app/`, `components/`, `hooks/`,
`lib/`, `actions/` returns **zero consumer call sites**. The only two `next-auth/react` imports in the whole repo are:

```
app/layout.tsx:6             import { SessionProvider } from "next-auth/react";   ← the provider itself
components/auth/login-form.tsx:20  import { signIn } from "next-auth/react";
```

`signIn` is a standalone function that does not consume the provider context. All other auth is server-side:
`lib/auth/session.ts:58` (`await auth()`), `requireOrg` (`:146`), `requireOrgBySlug` (`:153`), used by
`app/(protected)/[orgSlug]/layout.tsx:18` and 40+ server actions. Logout goes through the server action
`actions/auth.ts:322` (`signOut({ redirectTo: "/login" })`), not `next-auth/react`.

**Est. saving: ~47.5 KB chunk (`1rxzp4lce6kfx.js`, measured, contains `next-auth` + `sonner`; `next-auth/react.js`
is 15.2 KB + `lib/client.js` 3.0 KB unminified, so treat the next-auth share as ~10–20 KB minified) plus 1 network
request per page view and one client context provider + hydration subtree on public routes.**

**Minimal fix.** `app/layout.tsx:6,57,67` — delete the import and unwrap `<SessionProvider>`. Nothing else changes.
If a client session hook is ever needed, put `<SessionProvider>` in `app/(protected)/[orgSlug]/layout.tsx:20`
around `<SidebarProvider>` instead — the layout already has the session from `requireOrgBySlug` and can pass
`session={...}` as a prop, which also removes the `/api/auth/session` round-trip.

---

### 5. `Unbounded` is loaded globally and used by nothing — MEDIUM (highest saving-per-effort)
**Mechanism.** `app/layout.tsx:3` imports `Unbounded`; `app/layout.tsx:25-29` configures it and
`app/layout.tsx:47` puts `unbounded.variable` on `<html>`. That variable is `--font-unbounded`
(verified in the generated `unbounded_a23ecfdf.module.css`: `--font-unbounded: "Unbounded", "Unbounded Fallback"`).

**`--font-unbounded` is never referenced anywhere.** `app/globals.css:10` maps the heading font to a *different*
variable: `--font-heading: var(--font-serif);` and `--font-serif` is **not defined by any `next/font` call** —
tailwind's `font-serif` and `font-heading` therefore resolve to the browser/system default serif
(used at `components/layout/page-title.tsx:14`, `components/ui/dialog.tsx:132`, `components/ui/sheet.tsx:108`,
`components/ui/drawer.tsx:195`, `components/contacts/company-card.tsx:132`, `app/(protected)/[orgSlug]/contacts/error.tsx:24`).
So Unbounded is a global download that no selector consumes.

Weights loaded (from the generated font CSS, `.next/dev/static/chunks/[next]_internal_font_google_*_module_css_*.css`)
and per-route font list (from `.next/server/next-font-manifest.json`, where **every one of the 19 routes lists the
same 6 woff2 files**):

Every filename below is cross-referenced: each is named by exactly one family's generated `@font-face` block, and
its byte size is the measured `Length` from `.next/static/media/`. (An earlier draft of this report mis-attributed
three files to Unbounded; this table is the corrected, cross-checked version.)

| Family | Variable weight axis | Subsets emitted | Measured woff2 files (subset.bytes) | Sum |
|---|---|---|---|---|
| Geist | `100 900` (no `weight` arg → full axis) | cyrillic-ext, cyrillic, vietnamese, latin-ext, latin = **5** | fef07dbb(latin-ext).7 252 + 8a480f0b(**cyrillic**).16 540 + 53b9e256(vietnamese).7 968 + 7178b3e5(latin-ext2).15 204 + caa3a2e1(**latin**).29 288 | **76 252 B** |
| JetBrains Mono | `100 800` (full axis) | cyrillic-ext, cyrillic, greek, vietnamese, latin-ext, latin = **6** | 13bf9871(cyr-ext).2 020 + cc545e63(**cyrillic**).12 064 + 71b036ad(greek).9 084 + 89b21bb0(vietnamese).7 468 + 3fe682a8(latin-ext).15 204 + 70bc3e13(**latin**).40 480 | **86 320 B** |
| **Unbounded** | `200 900` (full axis) | cyrillic-ext, cyrillic, vietnamese, latin-ext, latin = **5** | d0d9446e(cyr-ext).1 816 + 4e1c87b7(**cyrillic**).31 460 + 3fd967fc(vietnamese).13 856 + dd14639a(**latin**).**117 648** + b59689b1(**latin**).**50 892** | **215 672 B** |

Total `@font-face`-declared woff2 on disk = **378 244 B (369.4 KB) across 16 files** for three families, of which
**Unbounded alone is 215 672 B (57 %)** despite the app rendering zero glyphs from it.

Fonts are **not preloaded** for `next/font/google` local files (no `<link rel="preload" as="font">` is emitted), so
the browser only fetches subsets actually matched by page text. A Russian-language page matches the `cyrillic`
subsets, and `latin` for ASCII (digits in `font-mono` tables, codes, `₽`). For Unbounded the two files that a
Russian page will actually pull are `4e1c87b7` (**31 460 B**) + `b59689b1` (**50 892 B**) = **82 352 B**; a page
with any non-Cyrillic Latin text additionally pulls `dd14639a` (**117 648 B**).

**Est. saving: 82 352 B measured for the cyrillic+latin case, up to 215 672 B if all subsets are ever matched —
most plausibly ~150 KB per page load — for a 2-line deletion.** This is the highest saving-per-effort item in the
report. (Per-page subset fetching is *unmeasured* here: no build-time HTML was readable, so which subsets the
browser requests is inferred from the `unicode-range` blocks plus the language of the rendered text.)

**Minimal fix.** `app/layout.tsx:3,25-29,47` — remove `Unbounded` from the import, delete the `const unbounded = ...`
block, and remove `unbounded.variable` from the `cn(...)` on line 47. Then, if a display face is actually wanted,
point `--font-heading` at the real family instead of leaving `app/globals.css:10` referencing an undefined
`--font-serif` (`--font-heading: var(--font-sans);` is the zero-cost fix today).
Secondary: `app/layout.tsx:19-35` — none of the three calls constrains `weight`, so all three ship the full variable
axis; adding `weight: ["400","500","600"]` on Geist and `weight: ["400","500"]` on JetBrains Mono would cut the
axes, though next/font subsets by unicode-range rather than by weight for variable fonts, so treat this as
*unmeasured* until a build diff confirms it.

---

### 6. `app/page.tsx` is a client component that only redirects — LOW but free
**Mechanism.** `app/page.tsx:1` is `"use client"` and `app/page.tsx:5` calls `redirect("/projects")` from
`next/navigation`. A client-side redirect means the client bundle must download, hydrate and execute before the
navigation happens — for a page whose entire purpose is to redirect. The route's client manifest confirms
`app/page.tsx` + `components/theme-provider.tsx` are its only client entries.

**Est. saving: one hydration + one client-side navigation (~2 JS chunks, and a visible redirect delay) on the
app's entry URL. Size unmeasured.**

**Minimal fix.** Delete `"use client"` from `app/page.tsx:1`. `redirect()` from `next/navigation` is available in
Server Components and throws `NEXT_REDIRECT` server-side, which produces an HTTP redirect — no client JS needed.
(`app/(protected)/projects/page.tsx:1-7` already does exactly this correctly with `redirect` + `requireOrg`.)

---

### 7. Error boundaries drag whole route segments into the client graph — LOW/INFORMATIONAL
`app/(protected)/[orgSlug]/projects/error.tsx`, `.../materials/error.tsx`, `.../contacts/error.tsx` are all
`"use client"` and were the only client entry point of the `app/(protected)/projects`, `app/(protected)/materials`,
`app/(protected)/contacts` **legacy redirect** pages. That is expected (error boundaries must be client
components), but it is worth knowing that adding an `error.tsx` to a segment adds a client boundary to every page
in that segment. No fix; noted so future "why is this chunk here" questions have an answer.

---

## Task 1 — client/server boundary on the initial render

### Client entry points, decoded from the production `page_client-reference-manifest.js` `clientModules` map

**`app/layout.tsx` (ROOT — applies to every route, incl. `/login`, `/share/spec/[token]`, `/`):**
`app/(auth)/login/page` and `app/page` manifests both list exactly `app/page.tsx`/`components/auth/login-form.tsx`
plus `components/theme-provider.tsx`. The root layout's own client surface is `SessionProvider`, `ThemeProvider`,
`Toaster`.

**`app/(protected)/[orgSlug]/projects` (9 client entries + error boundary):**
`components/theme-provider.tsx`, `components/layout/app-sidebar.tsx`, `components/ui/sidebar.tsx`,
`components/confirm-provider.tsx`, `components/project/create-project-dialog.tsx`,
`components/project/project-card.tsx`, `components/layout/search-block.tsx`,
`components/projects/projects-status-filter.tsx`, `components/projects/projects-sort.tsx`,
`components/projects/projects-filter-sheet.tsx`, `components/projects/projects-pagination.tsx`,
`app/(protected)/[orgSlug]/projects/error.tsx`.

**`app/(protected)/[orgSlug]/projects/[id]`:** the above shared set **minus** the list-only entries, **plus**
`components/project/edit-project-dialog.tsx`, `components/project/project-actions.tsx`,
`components/spec-builder/spec-builder.tsx`.

**`app/(protected)/[orgSlug]/materials`:** shared set **plus** `components/materials/materials-client.tsx`,
`components/materials/materials-create-button.tsx`, `components/materials/materials-import-button.tsx`,
`components/materials/materials-toolbar.tsx`, `components/materials/materials-pagination.tsx`.

**`app/(protected)/[orgSlug]/contacts`:** shared set **plus** `components/contacts/contacts-list.tsx`,
`components/contacts/contacts-toolbar.tsx`, `components/contacts/contacts-header-actions.tsx`,
`components/contacts/contacts-pagination.tsx`.

> Turbopack only records *client entry points* in this map; components imported by another client component are
> bundled into the same chunks without their own entry. The transitively-reached set below is therefore traced
> from source, and the identified heavy leaves are the ones that matter.

### Transitive client set, `app/layout.tsx` → `app/(protected)/[orgSlug]/layout.tsx` → `app-sidebar.tsx`

```
app/layout.tsx:5,6,7                        ThemeProvider, SessionProvider, Toaster(sonner)   [must be client: context + mount effects]
components/theme-provider.tsx:3             next-themes                                         [must be client: reads localStorage/matchMedia]
app/(protected)/[orgSlug]/layout.tsx:1,2,6  AppSidebar, ConfirmProvider, Sidebar{Provider,Inset} [server layout; children are client roots]
components/confirm-provider.tsx:3-10        Context + useState                                   [must be client: promise-returning confirm API]
components/layout/app-sidebar.tsx:1         "use client" — usePathname() + NAV map                [must be client: usePathname]
components/ui/sidebar.tsx:1                 "use client" — SidebarProvider (cookie write, keydown), useIsMobile, Sheet, Tooltip
components/orgs/org-switcher.tsx:1          "use client" — useTransition, usePathname, useIsMobile, DropdownMenu  [must be client]
components/layout/user-profile.tsx:1        "use client" — useState, useRouter, localStorage, DropdownMenu         [must be client]
components/auth/logout-dialog.tsx:1         "use client" — but has no hooks; plain conditional markup                [NOT required — could be server]
components/ui/dropdown-menu.tsx:1           "use client" — @base-ui/react/menu                                    [must be client]
components/ui/avatar.tsx:1                  "use client" — @base-ui/react/avatar                                  [must be client]
components/ui/tooltip.tsx:1                 "use client" — @base-ui/react/tooltip                                 [must be client]
components/ui/sheet.tsx:1                   "use client" — @base-ui/react/dialog                                  [must be client]
components/ui/scroll-area.tsx:1             "use client" — @base-ui/react/scroll-area                             [must be client]
components/ui/use-dialog-dismiss-guard.tsx:1 "use client" — @base-ui/react/dialog + internals/reasons              [must be client]
hooks/use-mobile.ts:1                       (no "use client" marker) but uses useState/useEffect + window.matchMedia → client-only in practice
```

**`components/auth/logout-dialog.tsx` is the one clearly-unnecessary client component** in this path: it imports
no hooks, no browser API, and no context (whole file is `if (!isOpen) return null` + plain JSX, lines 11-56). It
could be a Server Component rendered by `user-profile.tsx` as a child. Saving: small (its own chunk share), and
it needs prop threading, so it is a cleanup, not a win.

**Why each *must* be client, short version:** `app-sidebar`/`org-switcher`/`projects-pagination`/`search-block`/
`contacts-sort`/`projects-status-filter` need `usePathname`/`useSearchParams`/`useTransition`;
`user-profile` needs `useState` + `localStorage` + `useRouter`; every `components/ui/*` file that appears above
wraps a `@base-ui/react` primitive that uses state/refs/portals; `spec-builder.tsx` and the whole
`components/spec-builder/**` tree needs `useState`/`useEffect`/`useSyncExternalStore` and DnD-ish interaction.

**`app/page.tsx`:** `"use client"` at `:1` purely for `redirect` — see finding 6; does **not** need to be client.

---

## Task 3 — barrel / tree-shaking risks

* **No `import * from`, no `export * from`, and no `index.ts`/`index.tsx` barrel files anywhere under `app/`,
  `components/`, `hooks/`, or `lib/`.** Verified by grep for `export \* from|export \{ default as` (0 matches) and
  by globbing `**/index.{ts,tsx}` (only `node_modules` hits). There is no local barrel re-exporting a heavy module.
* **`import * as X` occurrences are benign:** `import * as React from "react"` (34 files) and
  `actions/spec-export.ts:16 import * as XLSX from "xlsx"` (server module).
* **`lucide-react` (2.72 MB unpacked, measured) is imported by named specifiers in all 118 import sites**
  (e.g. `components/layout/app-sidebar.tsx:14 import { BookUser, Folder, Layers, Settings } from "lucide-react"`).
  No wholesale icon-set import. The `lucide,clsx` chunks measured at 46.7 KB are the price of ~90 used icons, not
  a barrel leak.
* **`@base-ui/react` (3.92 MB unpacked, measured) is imported per-subpath** (`@base-ui/react/menu`,
  `/dialog`, `/tooltip`, …) — the correct, tree-shakeable form. The one deep import,
  `components/ui/use-dialog-dismiss-guard.tsx:5 import { REASONS } from "@base-ui/react/internals/reasons"`, is
  legitimate: `./internals/reasons` is a declared subpath export and its compiled payload is **66 bytes**
  (`node_modules/@base-ui/react/internals/reasons.mjs`, measured). `mergeProps`/`useRender` imports
  (`components/ui/sidebar.tsx:4-5`, `breadcrumb.tsx:2-3`, `badge.tsx:1-2`, `attachment.tsx:2-3`,
  `button-group.tsx:1-2`, `marker.tsx:2-3`) are heavier (`useRenderElement.mjs` is 7.4 KB) but still subpath-scoped.

---

## Task 5 — `SessionProvider` detail

See finding 4 for the fix. To restate the evidence compactly:

| Question | Answer | Evidence |
|---|---|---|
| Is `useSession` used client-side? | **No — zero call sites** | grep `useSession` across the repo matches only `next-auth` itself |
| Is the provider consumed transitively? | No; `signIn` does not require it | `components/auth/login-form.tsx:20,60` |
| Is there a server-side session path already? | Yes | `lib/auth/session.ts:56-58` (`cache(async () => await auth())`), `:146` `requireOrg`, `:153` `requireOrgBySlug` |
| Does the protected layout already have the session? | Yes | `app/(protected)/[orgSlug]/layout.tsx:17-18` destructures `user, userId, orgId, role, organizations` |
| Cost on public routes | `/api/auth/session` fetch after hydration + ~10–20 KB minified of `next-auth/react` + a client context on `/`, `/login`, `/share/spec/[token]` | chunk `1rxzp4lfg6kfx.js` = 47.5 KB (shares with `sonner`); `next-auth/react.js` 15 154 B + `lib/client.js` 2 987 B measured |

---

## Task 6 — hydration hazards

| # | Location | Hazard | Verdict |
|---|---|---|---|
| a | `components/ui/sidebar.tsx:608-610` | `useState(() => \`${Math.floor(Math.random() * 40) + 50}%\`)` — non-deterministic markup. Classic hydration-mismatch source. | **Not a live hazard: `SidebarMenuSkeleton` is dead code.** It is exported at `:714` but has **zero call sites** (grep across the repo). Delete it, or convert the width to a prop/`useId`-derived value before anyone uses it. |
| b | `hooks/use-mobile.ts:6-18` | `useState<boolean \| undefined>(undefined)` + `window.matchMedia` in an effect; returns `false` on the server and on the first client render, then flips. | **No mismatch, but a real re-render cost.** Every consumer re-renders once after mount: `components/ui/sidebar.tsx:182` swaps the whole sidebar between the desktop `<div>` and a mobile `<Sheet>`; `components/orgs/org-switcher.tsx:76` flips `side` between `"bottom"`/`"right"`; `components/ui/sidebar.tsx:546` toggles tooltip visibility. On a mobile client first paint is server-rendered **desktop sidebar markup** and is then thrown away. Fix: render the mobile `<Sheet>` branch on the *server* too when a `Sec-CH-Viewport-Width`/cookie hint exists, or accept it — but see next row. |
| c | `components/spec-builder/summary/spec-summary.tsx:283`, `:128-129`, `components/spec-builder/modals/modals.tsx:1075`, `components/spec-builder/project-expenses.tsx:14`, `components/spec-builder/layout/service-operation-badges.tsx:13`, `components/spec-builder/layout/add-service-combobox.tsx:230-232`, `app/(protected)/[orgSlug]/settings/team/page.tsx:103`, `app/share/spec/[token]/page.tsx:64`, `lib/utils.ts:56-61` (`fmtDate`) | `new Date(...).toLocaleDateString("ru-RU", …)` executed **during render**. | **Low risk but not clean.** `ru-RU` is explicit so there is no environment-locale dependence, and Next renders the same component on server and client, so output normally matches. The residual risks are (i) ICU data varying between the Node build and the browser, and (ii) the `new Date()` calls with no timezone (`spec-summary.tsx:283`, `modals.tsx:1075` → `new Date().toLocaleDateString("ru")` with no options) producing a different calendar day if server and client are in different time zones across midnight. Fix: pass the pre-formatted string from the Server Component (the data is already server-fetched) or add `timeZone: "Europe/Moscow"`. Note `lib/spec/activity-format.ts:749-759` already does the right thing by hoisting `Intl.DateTimeFormat` to module scope — reuse that pattern, since `fmtRub`/`fmt`/`fmtQty` in `lib/utils.ts:23-70` allocate `Intl` formatters per call and are called per row. |
| d | `components/layout/user-profile.tsx:48`, `hooks/use-spec-density.ts:23` | `localStorage` access | **Safe.** `user-profile` reads it inside the `handleLogoutClick` handler (`:45-56`), not during render. `use-spec-density.ts:46` reads inside `useSyncExternalStore` with an explicit server snapshot. |
| e | `components/spec-builder/summary/spec-summary.tsx:147`, `components/layout/image-crop-modal.tsx:49`, `components/ui/command.tsx:93`, `components/spec-builder/layout/add-section-picker.tsx:46-50`, `components/layout/search-block.tsx:191` | `document.*` / `window.*` | **Safe** — all inside event handlers or `useEffect` bodies, not during render. |
| f | `components/contacts/company-card.tsx:66` (`useId`), `components/layout/attrs-editor.tsx:49` (`useId`), `components/ui/form.tsx:75` (`React.useId`) | `useId` for `aria-labelledby`/`htmlFor` | **Safe and correct** — `useId` is hydration-stable by design. |
| g | `app/layout.tsx:51,54` | `suppressHydrationWarning` on `<html>` and `<body>` | Necessary for `next-themes`' pre-hydration class injection, but it is applied to the **whole document body**, which suppresses mismatch reporting for the entire tree (`:54`). Narrowing it to `<html>` only would restore body-level hydration warnings. |

---

## Task 8 — explicit "heavy lib is server-only / unused" results (no action needed)

Verified by grepping every client chunk that existed in the build for library-identifying strings:

| Library | Declared import site | Client bundle? | Verdict |
|---|---|---|---|
| `xlsx` (5.20 MB unpacked, measured) | `actions/spec-export.ts:16` — `import * as XLSX from "xlsx"` | **No.** Probed every `*.js` in `.next/static/chunks` for `XLSX` / `sheetjs` / `aoa_to_sheet`: 0 hits | ✅ server-only, safe |
| `@react-pdf/renderer` (38.9 KB unpacked + transitive) | `app/api/spec-pdf/[token]/route.tsx:2` (`renderToBuffer`, `renderToStream`), `lib/spec/pdf-document.tsx:2`, `lib/spec/pdf-fonts.ts:1` | **No.** Probed for `pdfkit`/`PDFDocument`/`renderToBuffer`/`yoga-layout`/`fontkit`/`brotli`: 0 hits. (A `Document` hit in `3-q4qjff0q96q.js` turned out to be `ownerDocument(...)` from base-ui, not react-pdf.) | ✅ server-only, safe |
| `@tanstack/react-table` v9 (41.1 KB unpacked) | **no import anywhere in the repo** | n/a | ⚠️ dead dependency — `package.json:24`. Safe to remove. |
| `react-image-crop` | `components/layout/image-crop-modal.tsx:4-10` (client) | **Yes** | ❌ finding 2 |
| `cmdk` | `components/ui/command.tsx:4` (client) | **Yes** (`4464v34jfm7wf.js`, `2-z-hlmty13o5.js`, 78.5 KB each) | ❌ finding 3 |
| `sonner` (159 KB unpacked) | `app/layout.tsx:7` (root layout, client) | **Yes** (`1rxzp4lfg6kfx.js`) | acceptable — toasts are used app-wide; `components/ui/sonner.tsx:1-49` is a thin wrapper and is **not** what the root imports (root imports `sonner` directly, bypassing the app's own themed wrapper — worth noting as an inconsistency, not a size issue) |

---

## Suggested order of work

1. **Delete `Unbounded`** — `app/layout.tsx:3,25-29,47`. ~168 KB of font bytes, 2-line change, zero risk. (finding 5)
2. **Delete `SessionProvider`** — `app/layout.tsx:6,57,67`. ~10–20 KB JS + one RTT per page view, and `useSession` has zero consumers. (finding 4)
3. **`dynamic(..., { ssr: false })` on `ProjectDialog`** — `components/project/create-project-dialog.tsx:9`, gated on the existing `isOpen`. ~297 KB off the projects list. (finding 1)
4. **`dynamic(..., { ssr: false })` on `ImageCropModal`** — `components/layout/material-image-field.tsx:9`. Removes `react-image-crop` + its CSS from every spec-builder page. (finding 2)
5. **`dynamic(..., { ssr: false })` on the five spec-builder modals** — `components/spec-builder/spec-builder.tsx:19,33,34,35,42`, gated on `useDialogUrl`. This is the largest measured chunk (902 KB). (finding 2)
6. **Make the three pickers lazy** — `company-picker.tsx`, `material-type-picker.tsx`, `category-multiselect.tsx`. ~78.5 KB from `projects/[id]`, `materials`, `contacts`. (finding 3)
7. **Remove `"use client"` from `app/page.tsx:1`.** (finding 6)
8. Cleanups: delete unused `SidebarMenuSkeleton` (`components/ui/sidebar.tsx:600-636,714`); drop the unused
   `@tanstack/react-table` dependency (`package.json:24`); point `--font-heading` at a font that exists
   (`app/globals.css:10`); make `logout-dialog.tsx` a server component.
