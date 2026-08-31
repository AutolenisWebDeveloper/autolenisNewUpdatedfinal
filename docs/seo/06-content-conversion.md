# 06 — Content + Conversion Instrumentation

Two questions: (1) how would an SEO opportunity reach the existing content workflow, and (2) is
the chain **Search → landing page → CTA → vehicle request → $99 deposit → auction → completed
deal** measurable today? Paths relative to `frontend/`.

---

## Part 1 — The existing content engines

**Two content engines already exist. A third must not be built.**

| Engine | Store | Route | Queue | Generator | Gate | Publisher |
| --- | --- | --- | --- | --- | --- | --- |
| **Content Engine** (buying-guide) | `content_articles` | `/buying-guide/[slug]` | `ContentGenerationJob` + `…JobItem` | `/api/cron/content-generation-drain` (`*/2 * * * *`) | `content-validation.service.ts` (multi-layer, `MIN_WORDS=700`) | `/api/cron/content-publisher` (`*/5 * * * *`) |
| **AMIPS** (market intelligence) | `amips_pages` | `/intelligence/[slug]` | `content_queue` | `/api/cron/amips-generate` (`0 6,14,22 * * *`) | `lib/amips/quality-gate.ts` (5 gates) | inline — `PUBLISHED` ⇒ `ACTIVE` (`amips-generator.ts:220`) |

**Admin surfaces:** `/admin/content` (index), `/admin/content/bulk`, `/admin/content/[id]`,
`/admin/content/attribution`; `/admin/amips` (+ `/report`, `/metro/[metro]`,
`/vehicle/[make]/[model]`). Nav: **Growth** section — "Content Engine" (`lib/admin/nav.ts:171`),
"SEO" (line 174); `/admin/content/bulk` and `/admin/content/attribution` are HUB children
(lines 244-245).

### The handoff path an SEO opportunity would take

An SEO opportunity today has **exactly one existing on-ramp**, and it is a queue table, not a UI:

| Step | Mechanism | Status |
| --- | --- | --- |
| 1. Opportunity identified | — | **no producer exists** (`02-data-sources.md`: no keyword/rank/GSC-query data) |
| 2. Enters a backlog | `ContentQueue` row (`priorityScore`, `contentTier`, `keywordTarget`) | table exists; seeded by `lib/amips/seed/content-queue.seed.ts` |
| 3. Re-prioritised from demand | `reprioritizeContentQueue()` — called by the GSC cron (`amips-search-sync/route.ts:40`) | **wired but degraded** — its `buyerValue` term is `Math.max(1, page.leadsGenerated)` (`content-queue.seed.ts:428`), always `1` (I-1) |
| 4. Generated | `amips-generate` cron, `BATCH_LIMIT = 17` | works |
| 5. Quality-gated | 5 gates | works, two defects (`05`, R-3/R-3a) |
| 6. Published | inline | works |

**Conclusion — do not design a second content engine.** The correct integration point for any SEO
growth system is **`ContentQueue` + `reprioritizeContentQueue()`**: an opportunity becomes a
queue row with a `priorityScore`. Everything downstream already exists. For `/buying-guide`
content the equivalent on-ramp is `POST /api/admin/content/articles/generate`
(`content.generate` capability), which enqueues `ContentGenerationJob` items.

**Gap:** there is no UI or API that writes a `ContentQueue` row. Seeding is code-only
(`content-queue.seed.ts`). An operator who spots an opportunity cannot act on it without a
deploy.

---

## Part 2 — Is the conversion chain measurable?

**Answer: partly, and only in the database. It is not measurable in any analytics product, and
it is not measurable at all for most of the indexable footprint.**

### The chain, link by link

| Link | Mechanism | Status |
| --- | --- | --- |
| **Search → landing** | GSC `page` dimension → `search_intelligence` | **PARTIAL** — `/intelligence/*` only; no query dimension (`02`, D-1/L-1, L-2) |
| **Landing → CTA click** | `trackArticleCTA` → `window.gtag` | **BROKEN** — no GA4 loader (`04`, T-2) |
| **Landing → attributed lead** | first-party cookie `al_content_attr` → `ContentAttribution` | **WORKS where mounted** — coverage gaps below |
| **Lead → vehicle request** | `POST /api/public/request-vehicle` persists `utmSource/Medium/Campaign`, `sourceUrl`, `landingSource`, `referrer` (`route.ts:275,283-284`) | **WORKS** |
| **Request → $99 deposit** | Stripe webhook → `markContentConversion` (`app/api/webhooks/stripe/route.ts:279,434`) | **WORKS** |
| **Deposit → conversion value** | `conversionValueCents` = Σ PAID deposits (`content-attribution.server.ts:105`) | **WORKS** |
| **Request → auction** | `VehicleRequest` → `Auction` | exists in the domain model; **not joined to any SEO attribution record** |
| **Auction → completed deal** | `vehicleRequests.some(r => r.status === "DEAL_CREATED")` (`content-attribution.server.ts:103`) | **WORKS** — deal creation counts as converted |

**The database-side chain is genuinely complete and well built** for the families it covers:
cookie set client-side (`lib/analytics/attribution.ts:51-64`, TTL-bounded, `SameSite=Lax`,
localStorage fallback) → read server-side at lead time
(`app/api/public/request-vehicle/route.ts:429-430`; `app/api/tools/dealer-fee-lead/route.ts:124-125`)
→ marked converted by the Stripe webhook → reconciled by
`reconcileContentConversions()` (`content-attribution.server.ts:78-129`, batched, two reads) →
surfaced at `/admin/content/attribution`. Every function is wrapped so attribution can never
break a buyer's submission (lines 10-11, 64-66).

**This is the strongest instrumentation in the SEO surface and must be preserved.**

---

## Instrumentation gaps — exact

### I-1 · `AmipsPage.leadsGenerated` is never written — CRITICAL
Full trace in `01-trust-audit.md`, C-6; production consequence in C-7 / `04`, T-1.

- **Missing:** a write of `amipsPage.leadsGenerated`.
- **Table/event required:** none new. `ContentAttribution` already records
  `articleSlug` + `converted` + `conversionValueCents`. What is missing is the **join back**:
  a `/intelligence/*` conversion never increments its `AmipsPage`. Either aggregate
  `ContentAttribution` by `articleSlug` into `amipsPage.leadsGenerated` (and
  `searchIntelligence.revenueAttribution` from `conversionValueCents`) on the weekly GSC cron,
  or write it at conversion time in `markContentConversion`.
- **Consequence while unfixed:** AMIPS "Leads" and "Revenue run-rate" read 0; the content queue's
  demand signal is inert; **and the lifecycle cron de-indexes performing pages** (T-1).

### I-2 · No GA4 destination — CRITICAL
`04`, T-2. All 21 funnel events (`funnel-events.ts:7-27`) including `deposit_paid` are discarded.

- **Missing:** a GA4/GTM loader. Not an env var — no `NEXT_PUBLIC_GA_ID` is declared in
  `env.d.ts`.
- **Consequence:** no funnel visualisation, no landing-page reports, no channel attribution, no
  audience building. The DB chain above answers *"did this article convert?"* but cannot answer
  *"where did users drop off?"*

### I-3 · The 104 city pages have no cross-session attribution — HIGH
`/car-buying-service/[city]` and `/car-buying-service/texas` **do not mount `ContentTracker`**
(verified: zero occurrences in either file), so they never drop the `al_content_attr` cookie.

They are **not** unattributed, though — they use a different mechanism:
`cityFormSource(loc.slug)` is passed to the embedded form as `source`
(`car-buying-service/[city]/page.tsx:143`), which the API persists to
`VehicleRequest.landingSource` (`request-vehicle/route.ts:283`). `FormSource` is a per-city
semantic token (`lib/seo/locations.ts:35-40`, e.g. `seo_city_dallas`).

- **Gap:** this is **same-page-submission only**. A visitor who lands on
  `/car-buying-service/frisco` from search, browses to `/inventory`, and converts three days
  later is attributed to whatever surface they finally submitted from. The 104-page local-SEO
  family — the highest-intent organic family — has **no last-touch attribution**.
- **Missing:** mount `ContentTracker` (or a city-page equivalent) on the city and hub templates
  so the existing cookie → `ContentAttribution` → deposit chain covers them. No new table
  required; `ContentAttribution` already carries `city`, `state`, `metro`.

### I-4 · The 6 pillar pages drop no attribution cookie — MEDIUM
`components/buying-guide/PillarArticle.tsx:70` mounts
`<ContentTracker articleSlug={slug} cluster="pillar" city="" state="" />`. `ContentTracker:40`
gates cookie capture on `if (cluster && city && state)` — **empty strings are falsy**, so the
cookie is never set.

- **Effect:** the six cornerstone pillar pages (`sitemap.ts:63-68`, priority **0.9** — the
  highest-priority content in the sitemap) generate no attributed leads. They will always appear
  to convert nobody.
- **Missing:** either relax the gate to `if (cluster)` with `city`/`state` optional, or pass a
  sentinel such as `city="national"`, `state="US"`. `ContentAttribution.city`/`.state` are
  non-nullable `String` (`prisma/schema.prisma:4533-4534`), so a sentinel is the smaller change.

### I-5 · AMIPS national tiers drop no cookie; metro tiers store the metro in the `city` column — MEDIUM
`app/(public)/intelligence/[slug]/page.tsx:111-117` passes
`city={page.metro ?? undefined}`, `state={page.state ?? undefined}`.

- **Tiers A/B are national** — `metro` and `state` are null (`amips-generator.ts:209-210`
  writes `data.market?.metro ?? null`), so the `if (cluster && city && state)` gate fails and
  **no cookie is set**. Same class of bug as I-4.
- **Tiers C/D/E do set a cookie**, but pass the **metro** as `city`. That value is persisted
  verbatim to `ContentAttribution.city` (`content-attribution.server.ts:55`). Any report grouping
  by `city` mixes true cities (from buying-guide) with metros (from AMIPS) — e.g.
  `"Dallas-Fort Worth"` appears as a city alongside `"Dallas"`. `ContentAttribution.metro`
  already exists (line 57) and is the correct column.
- **Missing:** pass `city` and `metro` distinctly; give national tiers a sentinel.

### I-6 · No attribution on transactional and category pages — MEDIUM
No `ContentTracker` and no `FormSource` on: homepage, `/inventory`, `/inventory/[vehicleId]`,
`/cars/[make]`, `/cars/[make]/[model]`, `/tools` (the calculator *reads* the cookie —
`components/tools/DealerFeeCalculator.tsx:32` — but no page in these families ever *sets* one).

- **Effect:** a buyer who arrives from organic search on a make/model or vehicle page and
  converts is attributed to nothing. Given F-12/F-13/F-16 are the largest URL families
  (`03-footprint-map.md`), this is a large blind spot.
- **Missing:** the same `ContentTracker` mount, with an appropriate `cluster` token.

### I-7 · Auction and deal outcomes are not joined to SEO attribution — MEDIUM
`ContentAttribution` marks `converted` on *deposit paid* or *`DEAL_CREATED`*
(`content-attribution.server.ts:103-104`) and stores `conversionValueCents` as the **deposit
sum** (line 105) — i.e. $99, not deal value.

- **Missing:** no link from `ContentAttribution` to `Auction` (offers received, dealer response
  rate) or to final deal economics. The chain answers *"did this page produce a $99 deposit?"*
  but not *"did it produce a completed deal, and what was it worth?"*
- **Table/field required:** either a nullable `dealId` on `ContentAttribution` plus a
  deal-completion value, or — preferred, since it avoids widening a lead-time table — a
  reconciliation that walks `buyerOpportunity → vehicleRequests → auction → deal` and writes a
  separate outcome row. `MarketplaceIntelligence` (`prisma/schema.prisma`, "one row per completed
  live buyer/dealer transaction… Schema only at launch; populated from real deals later") is the
  existing model designed for exactly this and is **not yet populated** — extend it rather than
  adding a new table.

### I-8 · `reconcileContentConversions` runs only on dashboard render — LOW
Its sole caller is `lib/services/analytics/content-attribution-analytics.service.ts:123`, invoked
when an admin loads the attribution page.

- **Effect:** conversion state is stale until someone opens `/admin/content/attribution`. The
  Stripe fast-path (`markContentConversion`) covers deposits, so the reconciler mainly catches
  `DEAL_CREATED` — which therefore lands only when an admin happens to look.
- **Missing:** a scheduled invocation. The platform pattern is a Vercel cron + `withCronRun()`
  writing to `cron_job_logs`; `/api/cron/analytics-refresh` (`0 2 * * *`) already exists and is
  the natural host — no new cron entry needed.

---

## Attribution coverage matrix

| Family | Sets `al_content_attr` | `landingSource` | Effective coverage |
| --- | --- | --- | --- |
| `/buying-guide/[slug]` programmatic | **yes** (`[slug]/page.tsx:174`) | — | **full** |
| `/buying-guide/*` pillar (6) | **no** — I-4 | — | **none** |
| `/intelligence/*` tiers C/D/E | yes, `city` = metro — I-5 | — | partial + mislabelled |
| `/intelligence/*` tiers A/B | **no** — I-5 | — | **none** |
| `/car-buying-service/[city]` (104) | **no** — I-3 | **yes** (`:143`) | same-page only |
| `/car-buying-service/texas` | **no** — I-3 | yes | same-page only |
| `/cars/*`, `/inventory*`, `/tools`, `/` | **no** — I-6 | — | **none** |

---

## What measurement would look like once fixed

No new analytics infrastructure is required for the database chain; every table already exists.
Ordered by leverage:

| # | Change | Unlocks | Effort |
| --- | --- | --- | --- |
| 1 | Fix I-1 (write `leadsGenerated`) | Stops T-1 de-indexing performing pages; makes AMIPS leads/revenue real; makes the queue's demand signal live | small |
| 2 | Fix I-4 + I-5 gates (sentinels) | Attribution for pillar pages and national AMIPS tiers | trivial |
| 3 | Mount `ContentTracker` on city/hub templates (I-3) | Cross-session attribution for the 104-page local family | small |
| 4 | Schedule `reconcileContentConversions` on `analytics-refresh` (I-8) | Deal-stage conversions land without a human opening a page | trivial |
| 5 | Mount tracker on `/cars/*` and `/inventory*` (I-6) | Attribution for the largest URL families | small |
| 6 | Populate `MarketplaceIntelligence` from completed deals (I-7) | True revenue attribution, not deposit-count | medium |
| 7 | Add a GA4 loader (I-2) | Funnel drop-off, channel reports, audiences | medium |
| 8 | Add the `query` dimension to the GSC pull (`02`, L-1) | Query-level analysis — prerequisite for every opportunity model | medium |
