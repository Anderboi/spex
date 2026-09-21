# Next.js 16 bundled-docs recon (READ-ONLY)

Scope: `E:\repositories\2026\SpecTrack\spectrack2depp`. No source file was modified; this report is the only file created.

## 0. Version and method

- Installed version (authoritative, project `package.json` + `node_modules/next/package.json`): **`next: 16.2.10`** (also `eslint-config-next: 16.2.10`, `react: 19.2.4`, `react-dom: 19.2.4`).
- **The docs themselves never contain the string "16.2.10".** The newest version rows found in the bundled docs are `v16.2.0` (e.g. `01-app/03-api-reference/02-components/link.md`, `.../05-config/01-next-config-js/logging.md`, `.../03-file-conventions/error.md`). So the doc corpus is a 16.2.x snapshot, and the exact patch string comes from package metadata, not from the docs.
- Docs root: `node_modules\next\dist\docs\`. Relevant subtrees: `01-app\01-getting-started\`, `01-app\02-guides\`, `01-app\03-api-reference\01-directives\`, `...\03-file-conventions\`, `...\04-functions\`, `...\05-config\01-next-config-js\`, `01-app\02-guides\upgrading\version-16.md`.

### Project context found during recon (matters for applying the rules below)

`E:\repositories\2026\SpecTrack\spectrack2depp\next.config.ts`:

```ts
const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  async rewrites() { /* /api/auth/:path* -> same */ },
}
```

- `cacheComponents` is **not** enabled and `experimental.serverActions.bodySizeLimit: "8mb"` is set. Therefore the **"Previous Model" caching guide is the one that applies to this project**, not the Cache Components guide (see §2). Both are documented below because Cache Components changes several defaults.
- There is **no `middleware.ts` and no `proxy.ts`** anywhere in the project tree (checked to depth 2). Any auth-boundary logic must therefore live in the DAL / Server Actions themselves, not in middleware/proxy.

---

## 1. Server Actions (`"use server"`)

### 1.1 Definition and invocation

- `01-app\03-api-reference\01-directives\use-server.md`
  - File-level directive marks all exports; inline directive marks a single function. Quoted: "The `use server` directive designates a function or file to be executed on the **server side**."
  - Client Components **cannot define** actions, only import them from a dedicated `'use server'` file. Callable as `onClick={() => fetchUsers()}`: `<button onClick={() => fetchUsers()}>Fetch Users</button>`.
- `01-app\01-getting-started\07-mutating-data.md`
  - "It's not possible to define Server Functions in Client Components. However, you can invoke them in Client Components by importing them from a file that has the `"use server"` directive at the top of it".
  - Invocation channels: `<form action>`, `<button formAction>`, event handlers, and `useEffect` wrapped in `startTransition`.
  - "Behind the scenes, actions use the `POST` method, and only this HTTP method can invoke them."
  - Warning quote: "Server Functions are reachable via direct POST requests, not just through your application's UI. Always verify authentication and authorization inside every Server Function."

### 1.2 NEW in 16: sequential dispatch on the client

`01-app\02-guides\server-actions.md` (this is a new dedicated Next.js-specific guide):

- "Next.js dispatches Server Actions one at a time per client. If a user triggers three actions in quick succession, the second waits for the first to finish, then the third waits for the second."
- "A consequence: do not rely on `Promise.all` to parallelize Server Actions from the client."

### 1.3 Single-roundtrip response model (data + UI)

`01-app\02-guides\server-actions.md`:

- "When a Server Action triggers an immediate revalidation, Next.js does the work inside one HTTP request: it runs the action, then re-renders the current route server-side."
- Re-render is included in the same response when the action calls `updateTag` or `revalidatePath`, calls `refresh`, mutates cookies via `cookies()`, or calls `redirect`.
- Exception: "`revalidateTag` with a stale-while-revalidate profile ... does **not** include a re-render in the action response."

### 1.4 Return-value serialization limits

- `use-server.md` § "Return values": "Server Function return values are serialized and sent to the client. Only return data the UI needs, not raw database records."
- `01-app\02-guides\server-actions.md`: "Constrain return values. Action returns are serialized to the client. Shape them to what the UI renders, not raw database records."
- **The bundled docs do not enumerate the exact serializable type set for Server Action arguments/return values.** The only concrete type list in the docs is for `use cache` in `01-app\03-api-reference\01-directives\use-cache.md` § Serialization (primitives, plain objects, arrays, Dates/Maps/Sets/TypedArrays/ArrayBuffers, React elements pass-through; unsupported: class instances, functions except pass-through, Symbols/WeakMaps/WeakSets, **URL instances**). For Server Actions the docs defer to React: "See the [React documentation](https://react.dev/reference/rsc/use-server)". **Flag: exact Server Action payload type rules are NOT in the bundled docs.**
- Closures: "Variables captured by an inline action are encrypted before being sent to the client. For multi-instance and self-hosted deployments, set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to a stable key shared across instances."

### 1.5 Body size limit

- `01-app\03-api-reference\05-config\01-next-config-js\serverActions.md`: "By default, the maximum size of the request body sent to a Server Action is 1MB". Configurable as bytes or a bytes-style string (`1000`, `'500kb'`, `'3mb'`).
- Important nuance not in older data: "The limit applies to the raw HTTP request body, including the bytes that `multipart/form-data` adds for boundaries, part headers, and field metadata. ... For typical multipart uploads, an additional 10–20 KB is a reasonable rule of thumb."
- Config shape is still nested under `experimental`: `experimental: { serverActions: { bodySizeLimit: '2mb', allowedOrigins: [...] } }`. (This project already sets `"8mb"`.)
- Separate, easy-to-miss limit when a Proxy exists: `01-app\03-api-reference\05-config\01-next-config-js\proxyClientMaxBodySize.md` — proxy buffers the request body, default cap **10MB**, string units `b|kb|mb|gb`, and exceeding it does **not** error: "The request will continue processing normally, but only the partial body will be available".

### 1.6 Allowed origins / CSRF

- `serverActions.md`: "A list of extra safe origin domains from which Server Actions can be invoked. Next.js compares the origin of a Server Action request with the host domain... If not provided, only the same origin is allowed."
- `01-app\02-guides\server-actions.md`: "**CSRF check.** The request's `Origin` is compared to the `Host` (or `X-Forwarded-Host`). Mismatches are rejected."
- `01-app\02-guides\data-security.md` § "Allowed origins (advanced)": "Server Actions can only be invoked on the same host as the page that hosts it." + "As an additional protection, Server Actions in Next.js also compare the Origin header to the Host header (or `X-Forwarded-Host`)."

### 1.7 Deployment: rotating action IDs

`01-app\02-guides\server-actions.md`: "New deployments typically generate new IDs (Next.js rotates them at most every 14 days, even when the source is unchanged)... The error surfaces as '[Failed to find Server Action]'."

---

## 2. Fetch / caching / revalidation in 16

### 2.1 Is `fetch` cached by default? — **No** (in both models)

- `01-app\01-getting-started\06-fetching-data.md`: "`fetch` requests are not cached by default and will block the page from rendering until the request is complete. Use the [`use cache`] directive to cache results, or wrap the fetching component in `<Suspense>` to stream fresh data at request time."
- `01-app\02-guides\caching-without-cache-components.md` (the model that applies to **this** project): "By default, [`fetch`] requests are not cached. You can cache individual requests by setting the `cache` option to `'force-cache'`."
- `01-app\03-api-reference\04-functions\fetch.md` describes the default as **`auto no cache`**: "Next.js fetches the resource from the remote server on every request in development, but will fetch once during `next build` because the route will be statically prerendered. If Request-time APIs are detected on the route, Next.js will fetch the resource on every request."

### 2.2 `fetch` options

`04-functions\fetch.md`:

- `cache: 'force-cache' | 'no-store'` (no `'default'` in the documented signature).
- `next: { revalidate: false | 0 | number }` — `false` = cache indefinitely, `0` = do not cache, number = seconds.
- `next: { tags: [...] }` — "The max length for a custom tag is 256 characters and the max tag items is 128."
- Conflicting options warning: "Conflicting options such as `{ revalidate: 3600, cache: 'no-store' }` are not allowed, both will be ignored".
- Memoization: "`fetch` requests using `GET` with the same URL and options are automatically memoized during a server render pass." **But**: "Memoization does not apply in Route Handlers, since they are not part of the React component tree."
- Dev gotcha: the HMR cache applies even to `cache: 'no-store'` ("uncached requests will not show fresh data between HMR refreshes"); and with a `cache-control: no-cache` request header, `cache`/`next.revalidate`/`next.tags` are ignored in dev.

### 2.3 Previous model (applies here, `cacheComponents` off)

`01-app\02-guides\caching-without-cache-components.md`:

- Time-based: `fetch(url, { next: { revalidate: 3600 } })`; non-fetch functions use `unstable_cache(fn, keys, { tags, revalidate })`.
- Route segment config `dynamic`: `'auto' | 'force-dynamic' | 'error' | 'force-static'`; `fetchCache`: `'auto' | 'default-cache' | 'only-cache' | 'force-cache' | 'force-no-store' | 'default-no-store' | 'only-no-store'`; `revalidate`: `false | 0 | number`.
- On-demand: `revalidateTag` / `revalidatePath` callable in Server Action or Route Handler.
- **But** see §2.5 — `revalidateTag` now requires a second argument even in this model.

### 2.4 Cache Components + `use cache` (opt-in, NOT enabled in this project)

- Config: `cacheComponents: true` at the **top level** of `next.config.ts` (`05-config\01-next-config-js\cacheComponents.md`). Supersedes `experimental.ppr`, `experimental.useCache`, `experimental.dynamicIO`. Quoted: "`cacheComponents` implements **Partial Prerendering (PPR)** as the default behavior in the App Router. This means the `experimental.ppr` configuration flag and the `experimental_ppr` route segment configuration are no longer necessary and have been removed."
- `01-app\03-api-reference\01-directives\use-cache.md`: `use cache` at file / component / function level; "When used at file level, all function exports must be async functions."
  - Default profile: "By default, `use cache` uses the `default` profile with these settings: **stale**: 5 minutes (client-side), **revalidate**: 15 minutes (server-side), **expire**: Never expires by time".
  - Constraints: "Cached functions and components **cannot** directly access runtime APIs like `cookies()`, `headers()`, or `searchParams`. Instead, read these values outside the cached scope and pass them as arguments."
  - `React.cache` isolation: values set outside a `use cache` boundary are invisible inside it.
  - Client-side: "The client router enforces a **minimum 30-second stale time**, regardless of configuration."
  - Version history: `v16.0.0` — `"use cache"` is enabled with the Cache Components feature; `v15.0.0` — introduced as experimental. So in 16 it is **stable when `cacheComponents` is on**, and inert/erroring otherwise.
  - Related directives exist in this version: `use-cache-private.md` and `use-cache-remote.md`.
- `migrating-to-cache-components.md` and `caching-without-cache-components.md` both exist; the latter is explicitly for "projects not using Cache Components" and says Cache Components "was introduced in version 16 under the `cacheComponents` flag".

### 2.5 Revalidation APIs — status and **breaking signature change**

- `01-app\02-guides\upgrading\version-16.md` § Caching APIs: "`revalidateTag` now requires a second argument specifying a `cacheLife` profile. The single-argument form is deprecated and will produce a TypeScript error."
  ```ts
  // Before
  revalidateTag('posts')
  // After
  revalidateTag('posts', 'max')
  ```
- `04-functions\revalidateTag.md`: signature `revalidateTag(tag: string, profile: string | { expire?: number }): void;`. Second arg `'max'` = stale-while-revalidate (recommended); deprecation note: "The single-argument form `revalidateTag(tag)` is deprecated. It currently works if TypeScript errors are suppressed, but this behavior may be removed in a future version." Also: `revalidateTag(tag, { expire: 0 })` is the documented escape hatch for webhooks that need immediate expiry.
- `revalidateTag` **cannot** be called in Client Components or Proxy; callable in Server Functions and Route Handlers.
- `04-functions\updateTag.md`: `updateTag(tag: string): void` — **new, Server-Action-only**, read-your-own-writes. "It cannot be used in Route Handlers, Client Components, or any other context." Calling it elsewhere throws.
- `04-functions\revalidatePath.md`: `revalidatePath(path: string, type?: 'page' | 'layout'): void`. Cannot be called from Client Components or Proxy. Note the temporary over-invalidation behavior: "Currently, it also causes all previously visited pages to refresh when navigated to again. This behavior is temporary".
- `refresh()` from `next/cache` — refreshes the client router from inside a Server Action; "The `refresh()` function does not revalidate tagged data" (`07-mutating-data.md`).
- `cacheLife` / `cacheTag` are **stable** in 16: "`cacheLife` and `cacheTag` are now stable. The `unstable_` prefix is no longer needed." (`version-16.md`).
- `cacheLife` profiles table (`01-getting-started\09-revalidating.md`): `default` 5m/15m/never, `seconds` 30s/1s/60s, `minutes` 5m/1m/1h, `hours` 5m/1h/1d, `days` 5m/1d/1w, `weeks` 5m/1w/30d, `max` 5m/30d/1y. Short-lived caches (`seconds`, `revalidate: 0`, or `expire < 5m`) are "automatically excluded from prerenders and become dynamic holes".

### 2.6 Stable vs experimental (as labeled in the bundled docs)

| Feature | Status in these docs | Doc |
| --- | --- | --- |
| Server Actions | Stable since 14, on by default | `serverActions.md` § "Enabling Server Actions (v13)" |
| `cacheComponents` + `use cache` | Stable directive, opt-in flag (v16 feature) | `use-cache.md` version history |
| `cacheLife`, `cacheTag` | Stable (no `unstable_` prefix) | `version-16.md` |
| `updateTag`, `refresh` | New in 16, documented without experimental label | `updateTag.md`, `refresh.md` |
| `forbidden` / `unauthorized` | **experimental** — requires `experimental.authInterrupts: true` | `forbidden.md`, `unauthorized.md` (`version: experimental`) |
| `after` (`unstable_after`) | **Stable** since 15.1.0 | `after.md` version history |
| `connection` | **Stable** since 15.0.0 | `connection.md` |
| `unstable_cache` / `unstable_noStore` | still `unstable_`-prefixed; `connection` "replaces `unstable_noStore`" | `caching-without-cache-components.md`, `connection.md` |
| `proxy` convention | v16: middleware deprecated → proxy (stable) | `proxy.md` version history |
| `unstable_instant` | draft/`version: draft` API | `instant-navigation.md`, `.../02-route-segment-config/instant.md` |
| `experimental.serverActions.*` | still under `experimental` key | `serverActions.md` |
| `authInterrupts` | `version: canary` in frontmatter | `authInterrupts.md` |

---

## 3. Route Handlers (`app/api/**/route.ts`)

- `01-app\01-getting-started\15-route-handlers.md` and `01-app\03-api-reference\03-file-conventions\route.md`.
- Signature: one exported async function per HTTP verb, `GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS`; unsupported verbs return 405. `OPTIONS` is auto-implemented when absent.
- Dynamic params are **Promises**: "`params`: a promise that resolves to an object containing the dynamic route parameters for the current route."
  ```ts
  export async function GET(request: Request, { params }: { params: Promise<{ team: string }> }) {
    const { team } = await params
  }
  ```
- Typed helper: "you can type the `context` parameter for Route Handlers with the globally available `RouteContext` helper":
  ```ts
  export async function GET(_req: NextRequest, ctx: RouteContext<'/users/[id]'>) {
    const { id } = await ctx.params
  }
  ```
  Types are generated by `next dev`, `next build`, or `next typegen`.
- **Caching default**: "Route Handlers are not cached by default. You can, however, opt into caching for `GET` methods. Other supported HTTP methods are **not** cached." Version history: "`v15.0.0-RC` — The default caching for `GET` handlers was changed from static to dynamic" (i.e. dynamic is the 16 behavior).
- Opt-in: `export const dynamic = 'force-static'` (previous model). With Cache Components on: "`GET` Route Handlers follow the same model as normal UI routes... They run at request time by default, can be prerendered when they don't access uncached or runtime data, and you can use `use cache` to include uncached data in the static response. **`use cache` cannot be used directly inside a Route Handler body; extract it to a helper function.**"
- Prerendering stops on: network requests, DB queries, async FS ops, request object properties (`req.url`, `request.headers`, `request.cookies`, `request.body`), `cookies()`, `headers()`, `connection()`, or non-deterministic operations.
- Segment config supported (route.md): `dynamic`, `dynamicParams`, `revalidate`, `fetchCache`, `runtime` (`'nodejs' | 'edge'`), `preferredRegion` — **but** `01-app\03-api-reference\03-file-conventions\02-route-segment-config\index.md` version history says: "`v16.0.0` — `dynamic`, `dynamicParams`, `revalidate`, and `fetchCache` **removed when Cache Components is enabled**." `dynamicParams` doc adds: "`dynamicParams` is not available when Cache Components is enabled." `export const experimental_ppr = true` is removed entirely.
- `runtime` (`.../02-route-segment-config/runtime.md`): default `'nodejs'`; `'edge'` is "**not supported** for Cache Components"; `runtime` "cannot be used in Proxy".
- Non-UI responses, CORS headers, streaming, webhooks, and body reading all documented in `route.md`. CORS at scale is pushed to Proxy or `next.config.js` headers.

### 3.1 Route Handler / serverless timeouts

- `01-app\03-api-reference\03-file-conventions\02-route-segment-config\maxDuration.md`: "The `maxDuration` option allows you to set the maximum execution time (in seconds) for server-side logic in a route segment. **Deployment platforms can use `maxDuration` from the Next.js build output to add specific execution limits.**"
  ```ts
  export const maxDuration = 5
  ```
  And: "If using Server Actions, set the `maxDuration` at the page level to change the default timeout of all Server Actions used on the page."
- `after.md` § Duration: "`after` will run for the platform's default or configured max duration of your route."
- `backend-for-frontend.md` § Deployment environment: "Some hosts deploy Route Handlers as lambda functions. This means: Route Handlers cannot share data between requests. The environment may not support writing to File System. **Long-running handlers may be terminated due to timeouts.** WebSockets won't work..."

---

## 4. Breaking changes relevant to this project

### 4.1 `middleware.ts` → `proxy.ts` (deprecated, renamed)

`01-app\02-guides\upgrading\version-16.md` § "`middleware` to `proxy`" and `01-app\03-api-reference\03-file-conventions\proxy.md`:

- "The `middleware` filename is deprecated, and has been renamed to `proxy`".
- "The `edge` runtime is **NOT** supported in `proxy`. The `proxy` runtime is `nodejs`, and it cannot be configured. If you want to continue using the `edge` runtime, keep using `middleware`."
- "The named export `middleware` is also deprecated. Rename your function to `proxy`." → `export function proxy(request: NextRequest) {}`
- Flags renamed: "`skipMiddlewareUrlNormalize` is now `skipProxyUrlNormalize`".
- `proxy.md` Runtime section: "Setting the `runtime` config option in Proxy will throw an error."
- **Critical security gotcha**: "Server Functions are not separate routes in this chain. They are handled as POST requests to the route where they are used, so a Proxy matcher that excludes a path will also skip Server Function calls on that path." + "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone."
- Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- Project status: **neither `middleware.ts` nor `proxy.ts` exists** here, so nothing to migrate today — but any future auth gate must account for the POST-to-the-page behavior above.

### 4.2 `params` / `searchParams` are Promises — synchronous access REMOVED

`version-16.md` § "Async Request APIs (Breaking change)":

- "Version 15 introduced Async Request APIs as a breaking change, with **temporary** synchronous compatibility. Starting with **Next.js 16**, synchronous access is fully removed. These APIs can only be accessed asynchronously."
- Applies to `cookies`, `headers`, `draftMode`, `params` in `layout.js`, `page.js`, `route.js`, `default.js`, `opengraph-image`, `twitter-image`, `icon`, `apple-icon`, and `searchParams` in `page.js`.
- New globally generated type helpers after `npx next typegen`: `PageProps`, `LayoutProps`, `RouteContext`.
  ```tsx
  export default async function Page(props: PageProps<'/blog/[slug]'>) {
    const { slug } = await props.params
    const query = await props.searchParams
  }
  ```
- Also newly async: image-generation `params` **and** `id` for `opengraph-image`/`twitter-image`/`icon`/`apple-icon` (but `generateImageMetadata` still gets sync `params`), and `id` for `sitemap` from `generateSitemaps`.

### 4.3 `next.config.ts` options

- `experimental.serverActions.bodySizeLimit` — still nested under `experimental`; default 1MB; bytes or `'8mb'`-style strings (§1.5). Also `allowedOrigins`.
- `images.remotePatterns` — documented in `01-app\03-api-reference\02-components\image.md` § Configuration options; `images.domains` is **deprecated**: "Deprecated since Next.js 14 in favor of strict `remotePatterns` in order to protect your application from malicious users."
  - Wildcards: "`*` match a single path segment or subdomain; `**` match any number of path segments at the end or subdomains at the beginning. This syntax does not work in the middle of the pattern."
  - Security warnings: "When omitting `protocol`, `port`, `pathname`, or `search` then the wildcard `**` is implied. This is not recommended because it may allow malicious actors to optimize urls you did not intend."; "Omitting the `search` property allows all search parameters which could allow malicious actors to optimize URLs you did not intend."
  - Redirect caveat: "any allowed `remotePatterns` that respond with a redirect will follow the redirect from the remote image server **without validating `remotePatterns` again** on the redirect location."
  - Related 16 defaults from `version-16.md`: `minimumCacheTTL` 60s → **4 hours**; `16` removed from `imageSizes`; `qualities` now `[75]` only; new local-IP block (`images.dangerouslyAllowLocalIP`, default false); `maximumRedirects` default **3**; `next/legacy/image` deprecated.
  - Project note: `remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }]` omits `pathname`/`search`, i.e. the implied-`**` case the docs warn about.
- Top-level promotions/renames in 16: `turbopack` moved out of `experimental`; `reactCompiler` stable top-level; `adapterPath` stable top-level in **16.2.0**; `eslint` option and `next lint` **removed**; `serverRuntimeConfig`/`publicRuntimeConfig` **removed** (use env vars, and `connection()` if the value must be read at runtime); `amp` config removed; `devIndicators.appIsrStatus|buildActivity|buildActivityPosition` removed; `unstable_rootParams` removed.
- `next dev` now outputs to `.next/dev` (concurrent dev/build) and a lockfile prevents duplicate instances.
- `next.config` with `.cjs`/`.cts` extensions: "currently **not** supported".

### 4.4 Other 16 breaking changes worth knowing (from `version-16.md`)

Node.js **20.9+** minimum (18 dropped), TypeScript 5.1+, Turbopack default for `next dev`/`next build` (a custom `webpack` config makes `next build` **fail** unless `--webpack`/`--turbopack` is passed), parallel-route slots now require explicit `default.js`, `scroll-behavior` override now opt-in via `data-scroll-behavior="smooth"`, App Router on React 19.2 canary (View Transitions, `useEffectEvent`, `Activity`).

---

## 5. Outbound HTTP / SSRF / `after()` / `connection()` / `forbidden` / `unauthorized`

### 5.1 Outbound requests and SSRF

- **The bundled docs contain no occurrence of "SSRF", "server-side request forgery", or a dedicated SSRF section** (verified by grep across the whole docs tree). Nothing about blocking private IP ranges, link-local addresses, DNS rebinding, or validating user-supplied URLs for `fetch`. **Flag: not documented.**
- Closest material:
  - `01-app\02-guides\backend-for-frontend.md` § "Proxying to a backend": "You can use a Route Handler as a `proxy` to another backend. **Add validation logic before forwarding the request.**" with an `isValidRequest(request.clone())` example and a fixed destination host (`new URL(pathname, 'https://nextjs.org')`).
  - Same file § Security: "Never trust incoming request data. Validate content type and size, and sanitize against XSS before use." / "**Use timeouts to prevent abuse and protect server resources.**" / "Always verify credentials before granting access. Do not rely on proxy alone for authentication and authorization." / "Store user-generated static assets in dedicated services... upload them from the browser and store the returned URI in your database to reduce request size."
  - `data-security.md` § Auditing: "`/[param]/` Folders with brackets are user input. Are params validated?" and "`proxy.ts` and `route.ts`: Have a lot of power. Spend extra time auditing these using traditional techniques."
  - The only local-IP security control in the framework is image-optimization-specific: `images.dangerouslyAllowLocalIP` — "This is not recommended for most users because it could allow malicious users to access content on your internal network."
  - `fetch` has no framework-level timeout option in `04-functions\fetch.md`; only an `AbortController` signal is documented (as a memoization opt-out): `fetch(url, { signal })`.

### 5.2 `after()`

`01-app\03-api-reference\04-functions\after.md` — imported from `next/server`, **stable since 15.1.0** (`unstable_after` was 15.0.0-rc). Usable in Server Components (incl. `generateMetadata`), Server Functions, Route Handlers, and Proxy.

- "`after` allows you to schedule work to be executed after a response (or prerender) is finished."
- "`after` is not a Request-time API and calling it does not cause a route to become dynamic. If it's used within a static page, the callback will execute at build time, or whenever a page is revalidated."
- Request-API access rule: allowed in Route Handlers and Server Functions; **forbidden** in Server Components — "Calling `cookies()` or `headers()` inside the `after` callback in a Server Component will throw a runtime error." Read them before `after` and pass values in.
- "`after` will be executed even if the response didn't complete successfully. Including when an error is thrown or when `notFound` or `redirect` is called."
- Duration/platform: governed by `maxDuration`; the doc documents the serverless contract via `globalThis[Symbol.for('@next/request-context')]` and `waitUntil(promise)` for platform implementers.

### 5.3 `connection()`

`01-app\03-api-reference\04-functions\connection.md` — `function connection(): Promise<void>`, from `next/server`, **stable since 15.0.0**.

- "The `connection()` function allows you to indicate rendering should wait for an incoming user request before continuing."
- "`connection` replaces `unstable_noStore` to better align with the future of Next.js."
- Use cases documented: per-request values (`Math.random()`), synchronous DB drivers (`better-sqlite3`, `node:sqlite`), and reading `process.env` at runtime rather than bundled at build time.
- In Route Handlers, hitting `connection()` terminates prerendering (see §3).

### 5.4 `forbidden` / `unauthorized`

- `04-functions\forbidden.md` (403) and `04-functions\unauthorized.md` (401) — both `version: experimental`, both from `next/navigation`, both gated on `experimental: { authInterrupts: true }` (`05-config\01-next-config-js\authInterrupts.md`, frontmatter `version: canary`).
- Usable in Server Components, Server Functions, and Route Handlers. "The `forbidden` function cannot be called in the [root layout]." (same limitation for `unauthorized`).
- Custom UI via `app/forbidden.tsx` / `app/unauthorized.tsx` file conventions (`03-file-conventions\forbidden.md`, `unauthorized.md`).
- Both "throw an error" — i.e. control-flow exceptions, so code after them does not run.

---

## 6. Client-side data fetching and React 19 hooks

### 6.1 Client-side fetching guidance

- `01-app\01-getting-started\06-fetching-data.md` § Client Components: two documented approaches — React's `use` API (pass an un-awaited promise from a Server Component into a Client Component, read it with `use(promise)` inside `<Suspense>`), or a community library (SWR / React Query). Explicitly: "These libraries have their own semantics for caching, streaming, and other features."
- `01-app\02-guides\single-page-applications.md`: SWR with `SWRConfig` + prerendered `fallback` data; React Query is delegated to its own SSR guide; browser-only components via `dynamic(..., { ssr: false })`; shallow routing via `window.history.pushState`/`replaceState` integrated with the Next router.
- `01-app\02-guides\backend-for-frontend.md` § Caveats: "Fetch data in Server Components directly from its source, not via Route Handlers" (build-time prerender fails; runtime costs an extra HTTP round trip). Client-side fetching is justified for client-only Web APIs and frequently polled data. Also: "Server Actions are queued. Using them for data fetching introduces sequential execution."
- Sharing data: `React.cache` + context provider pattern, with the caveat "`React.cache` is scoped to the current request only."

### 6.2 `useActionState` / `useTransition` / `useOptimistic` / `useFormStatus`

- `useActionState` — documented as the standard way to surface validation errors, returned state, and a `pending` boolean:
  - `07-mutating-data.md`: "While executing a Server Function, you can show a loading indicator with React's `useActionState` hook. This hook returns a `pending` boolean" → `const [state, action, pending] = useActionState(createPost, false)`.
  - `01-app\02-guides\forms.md`: "When using `useActionState`, the Server function signature will change to receive a new `prevState` or `initialState` parameter as its first argument." → `export async function createUser(initialState: any, formData: FormData)`.
  - Can be driven from a button too: `<button onClick={() => startTransition(action)}>`.
- `useTransition` — used to invoke actions from event handlers/effects: `const [isPending, startTransition] = useTransition()` then `startTransition(async () => { const updatedViews = await incrementViews(); setViews(updatedViews) })` (`07-mutating-data.md` § useEffect). Unhandled errors inside it "will bubble up to the nearest error boundary" (`10-error-handling.md`).
- `useOptimistic` — stable React 19 API, documented in `forms.md` § "Optimistic updates": `const [optimisticMessages, addOptimisticMessage] = useOptimistic<Message[], string>(messages, (state, newMessage) => [...state, { message: newMessage }])`, called before `await send(message)`.
- `useFormStatus` — from `react-dom`, "you'll need to create a separate component to render the loading indicator" (`forms.md`, `02-components\form.md`). Note: "In React 19, `useFormStatus` includes additional keys on the returned object, like data, method, and action."
- `useFormState` — replaced by `useActionState` (noted in `02-guides\upgrading\version-15.md`). The bundled 16 docs always use `useActionState`; `useFormState` does not appear in any 16 guide.
- No 16-specific deprecation of `useOptimistic`/`useTransition` is documented. In 16 these are stable React 19.2 APIs re-exported by the framework, not Next.js APIs. **The bundled docs contain no dedicated API-reference page for these React hooks** — they are only shown by example in the guides listed above.

---

## 7. Explicit "could NOT find in the bundled docs" list

1. The literal string **"16.2.10"** — docs stop at `v16.2.0` version rows; the patch version comes from `node_modules/next/package.json` and project `package.json`.
2. **Any SSRF content** — no "SSRF", no private-IP/link-local/DNS-rebinding guidance, no built-in outbound-request allowlist for `fetch`.
3. **Framework-level request timeouts for `fetch`** — only `AbortController` and platform `maxDuration` are mentioned; no `fetch` `timeout` option.
4. **An exact serializable-type list for Server Action arguments/return values** — the docs defer to React's `use-server` reference; only `use cache` has an in-repo type list.
5. **`unstable_after`** — only the version-history row exists ("`v15.0.0-rc` — `unstable_after` introduced"); the import shown everywhere is the stable `after`.
6. **`deprecations/` and `errors/` doc folders** — not present in `node_modules/next/dist/docs/`; deprecated-item notices only appear inline (e.g. `revalidateTag` single-arg, `images.domains`, `next/legacy/image`, `middleware` naming).
7. **`experimental.serverActions.bodySizeLimit` applying to Route Handlers** — no such statement; the only comparable Route Handler/Proxy body limit is `experimental.proxyClientMaxBodySize` (10MB default, proxy only).
8. **A "use cache" stability statement for projects without `cacheComponents`** — the directive is documented as a Cache Components feature; the docs describe `experimental.useCache`/`dynamicIO` as deprecated in favor of the top-level flag but do not define behavior of `"use cache"` with the flag off.
9. **`updateTag` / `refresh` availability outside Cache Components** — `updateTag.md` and `version-16.md` document them without conditioning on `cacheComponents`, but the caching guides that use them are Cache Components guides. **Not explicitly resolved in the docs.**
10. **`PageProps`/`LayoutProps`/`RouteContext` type contents** — only usage examples are given; the generated declarations live in `.next/types`.
