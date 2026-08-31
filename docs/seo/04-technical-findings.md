# 04 — Technical SEO Findings (statically determinable only)

Each finding: severity, evidence at `file:line`, and remediation. Paths relative to `frontend/`.
Nothing here required a crawl or live data; anything that would is listed as out of scope at the
end and is **not estimated**.

**Severity:** CRITICAL (active production harm) · HIGH · MEDIUM · LOW

---

## Findings

### T-1 · Performing AMIPS pages are automatically 404'd — CRITICAL
Full analysis in `01-trust-audit.md`, C-7. Restated here because it is a technical-SEO defect,
not only a trust defect.

- **Evidence:** `lib/amips/lifecycle-manager.ts:196-201` divides a never-written
  `leadsGenerated` (always `0`) by `clicks`; `0 < LOW_CONVERSION_THRESHOLD` (0.001, line 36) is
  always true. Cron `/api/cron/amips-lifecycle` `0 4 * * 2` (`vercel.json`) writes
  `lifecycleStatus:"UNDER_REVIEW"` (line 204). That status yields HTTP 404
  (`app/(public)/intelligence/[slug]/page.tsx:38,91`) and removal from both AMIPS sitemaps
  (`lib/amips/sitemap.ts:51`; `app/sitemap-intelligence.xml/route.ts:33`).
- **Effect:** any `/intelligence/*` page ≥90 days old, with non-stale data, **that recorded at
  least one click in the most recently synced GSC week**, is de-indexed. (`amipsPage.clicks`
  holds the latest synced week's total, not a cumulative count —
  `search-intelligence.pipeline.ts:230-233`.) Pages with zero clicks that week are untouched.
  Ranking equity, link equity and crawl history are destroyed for the best pages first.
- **Remediation:** treat an unwritten conversion metric as *unknown*, not *zero* — gate
  `lowConversion` on `leadsGenerated` actually being populated (e.g. require
  `p.leadsGenerated > 0 || <attribution known>` before the comparison), and separately close the
  `leadsGenerated` write path (`06-content-conversion.md`, I-1). Until fixed, the safest
  immediate mitigation is disabling the `amips-lifecycle` cron.

### T-2 · No GA4 loader — every funnel event is discarded — CRITICAL
- **Evidence:** `lib/analytics/funnel-events.ts:58` and `lib/analytics/events.ts:20` call
  `window.gtag?.(…)`. `app/layout.tsx:87-107` loads only Clarity (102), TikTokPixel (104) and
  the service worker (100). Repo-wide grep for `gtag/js`, `googletagmanager.com` and a
  `G-XXXXXXXXX` id across `app/`, `components/`, `public/`: **zero matches**. No
  `NEXT_PUBLIC_GA_ID` is declared in `env.d.ts`.
- **Effect:** all 21 funnel events (`funnel-events.ts:7-27`), `deposit_paid` included, no-op.
  `dataLayer.push` writes to an array nothing reads.
- **Remediation:** load GA4 (or a server-side collector) behind an env-gated component in the
  same pattern as `components/seo/Clarity.tsx`. Not a config change — the loader does not exist.

### T-3 · Four public pages ship with no metadata — HIGH
- **Evidence:** of 57 public `page.tsx`, four export neither `metadata` nor `generateMetadata`:
  `app/(public)/dealer-application/page.tsx:36`, `app/(public)/feedback/page.tsx:13`,
  `app/(public)/refinance/eligibility/page.tsx:83`, `app/(public)/refinance/confirm/page.tsx:242`.
- **Effect:** each inherits the root default title *"AutoLenis — The Car Buying Experience You
  Deserve"* and root description (`app/layout.tsx:61-67`), and — because
  `alternates.canonical` is set only by `buildPageMetadata` (`lib/seo/metadata.ts:26`) — emits
  **no canonical**. `/dealer-application` is submitted in the sitemap at priority 0.6
  (`app/sitemap.ts:31`), so a duplicate-titled, non-canonical page is actively advertised.
- **Remediation:** add `buildPageMetadata({...})` to each; add
  `/refinance/eligibility|confirm` and `/feedback` to the sitemap or leave them out
  deliberately.
- **Correction to a plausible misreading:** `/car-buying-service/texas` **does** have metadata —
  it uses a *synchronous* `export function generateMetadata()` (`texas/page.tsx:46`), which a
  regex looking only for `export const metadata` or `export async function generateMetadata`
  misses. It is correctly configured.

### T-4 · Every AMIPS URL is submitted twice, defeating per-tier tracking — MEDIUM
- **Evidence:** `robots.ts:33,35` declares both `/sitemap-amips.xml` (index → tiers a–d,
  `lib/amips/sitemap.ts:91-109`) and `/sitemap-intelligence.xml`. The tier sitemaps select
  `contentTier: tier, lifecycleStatus:"ACTIVE"` (`sitemap.ts:51`); the intelligence sitemap
  selects **all** `lifecycleStatus:"ACTIVE"` (`sitemap-intelligence.xml/route.ts:33`). Every
  tier A–D page therefore appears in two declared sitemaps.
- **Effect:** Google dedupes URLs, so this is not an indexing bug — but it defeats the stated
  purpose of tier segmentation (`lib/amips/sitemap.ts:3-5`: *"cohorts can be submitted and
  indexation tracked per tier"*). GSC per-sitemap coverage numbers become unattributable.
  Secondary: Tier **E** and Tier **F** pages (Tier F is written by
  `lib/amips/pipelines/tier-f-threshold.pipeline.ts:109,116`) have no tier sitemap at all — they
  appear only in the intelligence sitemap, so the index is incomplete on its own terms.
- **Remediation:** pick one. Either drop `/sitemap-intelligence.xml` from `robots.ts` and add
  tier E/F sitemaps, or drop the tier sitemaps and accept a single intelligence sitemap.

### T-5 · `force-dynamic` silently voids `generateStaticParams` and `revalidate` — MEDIUM
- **Evidence:**
  - `app/(public)/cars/[make]/page.tsx:15-16` — `dynamic="force-dynamic"` **and**
    `revalidate=3600`, plus `generateStaticParams()` at line 122.
  - `app/(public)/cars/[make]/[model]/page.tsx:8-9,21` — identical combination.
  - `app/(public)/compare/page.tsx:9-10` — `force-dynamic` + `revalidate=86400`.
- **Effect:** `force-dynamic` opts the route out of static generation entirely, so
  `generateStaticParams` pre-renders nothing and `revalidate` is inert. Every make, make+model
  and `/compare` request is rendered on demand with a live DB query. The author's intent
  (ISR-cached programmatic pages) is not what ships. This is a crawl-budget and TTFB cost across
  the largest DB-driven family, and the contradiction hides the intent from future maintainers.
- **Remediation:** decide per route. For F-12/F-13, remove `force-dynamic` and keep
  `revalidate` + `generateStaticParams`. Confirm each page's data access tolerates static
  generation first.

### T-6 · `/buying-guide/[slug]` route and sitemap disagree on `lifecycleStatus` — MEDIUM
- **Evidence:** the sitemap requires
  `{ status:"PUBLISHED", noindex:false, lifecycleStatus:"ACTIVE" }` (`app/sitemap.ts:104`); the
  page requires only `{ slug, status:"PUBLISHED" }`
  (`app/(public)/buying-guide/[slug]/page.tsx:53`).
- **Effect:** an article moved off `ACTIVE` (refresh/review/retired) is dropped from the sitemap
  while still serving a **200, indexable** page. It becomes a live orphan: no sitemap entry, no
  removal, no `noindex`. (The AMIPS equivalent has the opposite bug — see T-1 — so the two
  content systems diverge in opposite directions.)
- **Remediation:** align them. Decide whether non-`ACTIVE` articles should 404, `noindex`, or
  stay indexed, and apply the same predicate in both places.

### T-7 · The entire `/intelligence/*` family is orphaned — HIGH
- **Evidence:** grep across `app/(public)/**` and `components/**` for `/intelligence/` returns
  **no public inbound link**. The only reference is an admin button
  (`components/admin/amips/ExecutiveIntelligenceDashboard.tsx:505`) linking to `/intelligence` —
  a route that **does not exist** (`app/(public)/intelligence/` contains only `[slug]`), so that
  button 404s as well.
- **Effect:** the largest programmatic family is discoverable only via sitemap. No internal
  PageRank flows to it, no crawl path exists from the homepage, and there is no hub for users.
  Combined with T-1, pages are hard to discover and then removed once found.
- **Remediation:** build `/intelligence` as a real index/hub page, link it from the public nav
  or footer, and cross-link intelligence pages to the relevant city (F-6) and make/model (F-13)
  pages. Fixes the broken admin button at the same time.
- **Approximation note:** orphan status here is inferred from static link analysis of source
  files, not a crawl. It is high-confidence (a link would have to exist in source to be
  rendered) but is formally an approximation.

### T-8 · Sitemap generation fails silently on DB error — MEDIUM
- **Evidence:** `app/sitemap.ts:93-95`, `115-117`, `143-145` — three bare `catch {}` blocks with
  comment-only bodies. `lib/amips/sitemap.ts:61-64` likewise (`rows = []`).
- **Effect:** a DB outage or a Prisma error during ISR regeneration yields a **valid, much
  smaller sitemap** rather than an error. Every vehicle, article, make and make+model URL
  silently disappears; the 1-hour ISR cache (`sitemap.ts:10`) then serves that truncated sitemap
  for an hour. No log, no alert, no Sentry event. `app/sitemap-intelligence.xml/route.ts:45`
  does log (`logger.error`) — the good pattern exists in the codebase but is not applied in
  `app/sitemap.ts` or `lib/amips/sitemap.ts`.
- **Remediation:** log at `error` and emit a Sentry event in every catch; consider serving the
  last-known-good sitemap rather than a truncated one.

### T-9 · Private portals rely on `robots.txt` alone — MEDIUM
- **Evidence:** `app/robots.ts:9` disallows `/buyer/`, `/dealer/`, `/affiliate/portal/`,
  `/admin/`, `/api/`, `/auth/`. Grep of `proxy.ts` for `noindex` / `X-Robots-Tag`: **no
  matches** (only `robots.txt` path allowances at lines 124-132, 182). No `noindex` metadata was
  found on portal layouts.
- **Effect:** `Disallow` prevents crawling, not indexing — a URL linked from elsewhere can still
  be indexed URL-only. These routes are auth-gated, so exposure is low, which is why this is
  MEDIUM not HIGH. But defence in depth is missing.
- **Remediation:** add `X-Robots-Tag: noindex` for the private route groups in `proxy.ts` (the
  repo's designated edge-gating layer — there is intentionally no `middleware.ts`).

### T-10 · `localBusinessSchema` hardcodes Texas but is emitted nationally — MEDIUM
- **Evidence:** `lib/seo/jsonld.tsx:83` — `areaServed: { "@type":"State", name:"Texas" }`, with
  a single fixed `PostalAddress` (line 75) and `geo` (line 82) from `AUTOLENIS_NAP`. It is
  imported by `app/(public)/cars/[make]/page.tsx:10` and emitted on **every** make and
  make+model page, which are national.
- **Effect:** structured data asserts a Texas-only service area on pages targeting nationwide
  make/model queries, contradicting the 104 city pages across 21 states (F-6). Inaccurate
  structured data is an eligibility risk for rich results and a trust signal mismatch.
- **Remediation:** parameterise `areaServed`, or use `professionalServiceSchema`
  (already parameterised — `car-buying-service/[city]/page.tsx:109-116`) on national pages.

### T-11 · Make/model sitemap coverage capped at 200 combinations — MEDIUM
- **Evidence:** `app/sitemap.ts:123-128` — `distinct: ["make","model"], take: 200`. Both
  `makeModelEntries` **and** `makeEntries` are derived from that same capped 200-row result
  (lines 130-142).
- **Effect:** past 200 distinct make+model pairs, both families stop growing in the sitemap even
  though the pages render. The make list is doubly constrained — it is derived from capped
  combos rather than a `distinct: ["make"]` query of its own.
- **Remediation:** query makes separately with its own `distinct`; paginate or raise the
  make/model cap toward the 50 000 URL limit already used elsewhere (`lib/amips/sitemap.ts:21`).

### T-12 · Dead SEO code contradicts the live implementation — LOW
- **Evidence, all with zero callers:** `lib/services/seo/seo-sitemap.service.ts:6`
  `generateSitemap()` (its own hardcoded 14-page `STATIC_PAGES`, line 4, contradicts the ~40
  static entries in `app/sitemap.ts:14-60`); `lib/services/seo/seo-schema.service.ts:4`
  `generateOrganizationSchema()` (the live Organization schema is
  `components/seo/OrganizationSchema.tsx` via `app/layout.tsx:94`);
  `lib/services/seo/seo.service.ts:6,17` `upsertPageConfig`/`getPageConfig`;
  `lib/services/seo/seo-audit.service.ts:5` `auditAllPages`.
- **Effect:** a maintainer reading `lib/services/seo/` gets a materially wrong picture of how
  AutoLenis does SEO. This is how C-1/C-2 in `01-trust-audit.md` came to be shipped.
- **Remediation:** delete or wire up. Do not leave in place.

### T-13 · Truncation without validation on AMIPS titles/descriptions — LOW
- **Evidence:** `lib/amips/amips-generator.ts:207-208` (create) and `232-233` (update) —
  `article.title.slice(0,70)` and `article.metaDescription.slice(0,160)`.
- **Effect:** hard character truncation can end a title or description mid-word, producing
  SERP snippets like *"Best Price on a 2024 Toyota Camry in Dallas — What Dealers Actu"*. There
  is no minimum-length check either, so a very short generated description passes.
- **Remediation:** validate length in the quality gate and regenerate on violation rather than
  truncating after the fact.

---

## Verified-correct — do not "fix" these

| Behaviour | Evidence |
| --- | --- |
| Faceted `/inventory` filters emit `noindex, follow`, canonical pinned to the clean path | `app/(public)/inventory/page.tsx:19,25-27` — textbook correct |
| `/lp/*` paid funnel `noindex, follow` **and** `Disallow` so it never competes with the organic hub | `lp/[campaign]/page.tsx:103-105`; `robots.ts:10` |
| Token pages carry page-level `robots:{index:false,follow:false}` rather than a `robots.txt` block | `dealer-offer/[token]/page.tsx:6`; `dealer-offer-outside/[token]/page.tsx:9`; `buyer-offer-review/[reviewToken]/page.tsx:6` — correct: a `Disallow` would prevent Google seeing the `noindex` |
| Self-canonical, absolute-URL metadata builder with OG + Twitter | `lib/seo/metadata.ts:17-44` |
| `metadataBase` set for correct relative-URL resolution | `app/layout.tsx:68-70` |
| Explicit, auditable AI-crawler allow policy | `app/robots.ts:16-27` |
| Tier sitemap casing matches stored values (`"A"`–`"D"`) | routes pass uppercase; `lib/amips/seed/content-queue.seed.ts:253,266,281` |
| `Prisma.DbNull` JSON-null filter (a real prior bug fix) | `app/admin/seo/schema/page.tsx:7-10` |
| Sitemaps + robots reachable without a session | `proxy.ts:124-132,182` |

---

## Out of scope this batch — requires crawl infrastructure, not attempted

No estimate is offered for any of these. There is no crawler in the repository (`02`, D-8).

| Item | Why code cannot answer it |
| --- | --- |
| Live broken links (4xx/5xx) | Requires fetching every URL |
| Redirect chains and loops | Requires following live `Location` headers |
| **Confirmed** orphan pages | T-7 is a static-link approximation; only a crawl proves reachability |
| Real crawl depth | Requires a BFS from the homepage against rendered HTML |
| Field Core Web Vitals (LCP/CLS/INP) | Requires CrUX or RUM; neither exists (`02`, D-4) |
| Actual index coverage | Requires GSC Index Coverage; the code stores only `indexedStatus` inferred from impressions (`search-intelligence.pipeline.ts:211`) |
| Rendered-HTML validation of JSON-LD | Requires executing the page and validating output |
| Duplicate-content clustering across live pages | Requires crawling rendered bodies (`05` measures templates instead) |
