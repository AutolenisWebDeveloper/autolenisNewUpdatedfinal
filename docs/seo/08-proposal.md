# 08 — SEO Growth System Design

## Conditional branch taken: **BRANCH B — Integration Requirements Specification**

**Why.** `02-data-sources.md` classifies Google Search Console **PARTIAL**, not ACTIVE. The
integration is real, running and well-built — service-account JWT auth, a live weekly Vercel cron
(`0 5 * * 1`), `withCronRun()` monitoring, persistence to `search_intelligence`. But one fact
decides the branch:

> `lib/amips/pipelines/search-intelligence.pipeline.ts:152` requests `dimensions: ["page"]`.
> **No query dimension is ever requested, and `search_intelligence` has no query column**
> (`prisma/schema.prisma:4673-4695`).

Striking distance, low-CTR, decline and cannibalization are **all query-level analyses**. Every
one is impossible against the data as persisted. A second constraint compounds it: the pipeline
filters to `/intelligence/*` (`pipeline.ts:30,172`), discarding the homepage, all 104 city pages,
the Texas hub, `/buying-guide/*`, `/cars/*` and `/tools/*` — data GSC already returned in the
same response.

Designing a striking-distance dashboard today would mean inventing the data it displays. That is
precisely the failure mode `01-trust-audit.md` documents seven instances of. **So: specification
first, then the operating model it unlocks.**

**The gap is small and the fix is an extension, not a build.** The auth, cron, monitoring,
persistence and admin surfaces all exist. This is one dimension, one filter and one table away
from ACTIVE — which is why Branch B here is a short spec, not a project.

---

## Part 0 — Five defects to fix before any new capability

Ordered strictly by business damage. 0.1 is destroying organic assets right now; 0.1b and 0.1c
are scheduled to.

| # | Defect | Effect | Fix |
| --- | --- | --- | --- |
| **0.1** | Lifecycle staleness branches: Tier C/D/E expire 30d after generation with no refresh path; Tier F stale from birth (`isTierCPlus` includes `"F"`, assembler never sets F's as-of dates) | **609 of 794 pages (76.7%) return HTTP 404 and are in no sitemap — today** | See `10`, C-3/C-4. Decouple `REFRESH_REQUIRED` from non-servable |
| **0.1b** | `noImpressions` (180d) and `RETIRED` (365d) read an **empty** `search_intelligence` | Arms **2026-12-05**: flags every remaining `ACTIVE` page at once | See `10`, C-2. Treat absent data as unknown, never zero |
| **0.1c** | `AmipsPage.leadsGenerated` never written; `lifecycle-manager.ts:196-201` divides it by clicks | **Latent** — `clicks = 0` corpus-wide closes it. Arms when the GSC sync starts writing | See `10`, C-1. Gate on the metric being populated |
| **0.2** | `content-validation.service.ts:245` `required:false` + corpus scoped to `cluster + city` | Near-duplicate buying-guide articles publish unchecked across cities | Make `duplicate` REQUIRED; widen the corpus across cities within a cluster |
| **0.3** | `quality-gate.ts:37,39` module-level `/g` regexes used with `.test()` | Roughly every second AMIPS page containing "guaranteed" passes the compliance gate | Drop the `/g` flag |

**Nothing in this proposal should be built before 0.1/0.1b/0.1c.** Adding pages to a system in
which 76.7% of the existing corpus already 404s compounds the loss.

> **Revised 2026-08-31 against owner-verified production state — see
> `10-production-reconciliation.md`.** The original 0.1 described the leads-ratio branch as
> actively de-indexing pages. It is **latent**; the active damage comes from the staleness
> branches, now 0.1. Ordering is unchanged in spirit — lifecycle correctness still precedes every
> other item — but the specific fixes differ. **Note the perverse coupling: repairing the GSC
> sync (Phase 1/2 below) arms 0.1c.** Ship 0.1c before, or with, any sync repair.

---

## Part 1 — GSC integration requirements specification

Extends the existing pipeline. No new infrastructure: **Vercel cron + Postgres via
`withCronRun()` writing to `cron_job_logs`**, per the platform pattern. Inngest is retired;
QStash/Make/GHL/Buffer are not proposed.

### 1.1 Auth model — no change required
Already correct and dependency-free (`pipeline.ts:19-20,68-100`): base64 service-account JSON in
`GOOGLE_SEARCH_CONSOLE_KEY`, `jose`-signed RS256 JWT-bearer assertion → OAuth access token →
`fetch`. Reuse verbatim.

**Requirements:** the service account must be a **user on the GSC property** (owner checks V-6…V-8);
`GSC_SITE_URL` must match the property string exactly (`sc-domain:autolenis.com` and
`https://autolenis.com/` are different properties and a mismatch 403s silently).

### 1.2 API scopes
`https://www.googleapis.com/auth/webmasters.readonly` (`pipeline.ts:27`) is sufficient for all
Search Analytics work below. **Do not widen it.** Only two things would need more:

| Capability | Scope | Recommendation |
| --- | --- | --- |
| Search Analytics (all analyses here) | `webmasters.readonly` | keep |
| Sitemap submission | `webmasters` (write) | **not recommended** — sitemaps are already declared in `robots.ts:29-36`; Google discovers them |
| URL Inspection API | `webmasters.readonly` | optional later; separate strict quota (1.3) |

### 1.3 Quota limits — **UNVERIFIED-AGAINST-LIVE-DOCS**
No network access in this session; cited from knowledge. Verify at
`developers.google.com/webmaster-tools/limits` before implementation.

| Limit | Value (verify) | Design consequence |
| --- | --- | --- |
| Search Analytics rows per request | 25 000 | already the `rowLimit` (`pipeline.ts:153`); **pagination via `startRow` is missing** and must be added |
| QPS per site | ~short-term burst limits apply | sequential requests only; no fan-out |
| Queries per day, per site & per project | daily caps apply | a weekly job over ~16 months of backfill must be spread, not bursted |
| Data freshness | 2–3 day lag | already handled — the cron targets the previous complete week (`route.ts:26-28`) |
| Data retention | 16 months | the backfill ceiling (1.6) |
| URL Inspection | ~2 000/day, 600/min per property | only relevant if true index-status is wanted later |

**Row-count reality check:** with `dimensions: ["page","query"]`, row volume is roughly
*pages × distinct queries per page*, which for a site of this footprint plausibly exceeds 25 000
rows per week. **Pagination is mandatory, not optional** — without it the current code would
silently truncate (`02`, L-4).

### 1.4 Persistence schema — **DDL PROPOSAL ONLY, NOT A MIGRATION**

> **No migration is created by this batch.** Migrations `20261014`, `20261015`, `20261016` are
> frozen pending attorney review and are neither referenced nor built upon. The following is a
> design artifact for owner approval.

One new table. `search_intelligence` is **kept unchanged** — it is the page-level weekly rollup
that `executive-intelligence.ts`, `indexation-gate.ts` and `lifecycle-manager.ts` already read,
and changing its grain would break all three.

```sql
-- PROPOSAL ONLY — do not apply. Query-level GSC performance, one row per
-- (page, query, week). Sibling to search_intelligence, which stays page-level.
CREATE TABLE search_query_performance (
  id             TEXT PRIMARY KEY,
  url            TEXT        NOT NULL,
  query          TEXT        NOT NULL,
  page_family    TEXT        NOT NULL,  -- 'intelligence'|'city'|'guide'|'cars'|'inventory'|'tools'|'static'
  impressions    INTEGER     NOT NULL DEFAULT 0,
  clicks         INTEGER     NOT NULL DEFAULT 0,
  ctr            DOUBLE PRECISION,
  avg_position   DOUBLE PRECISION,
  week_of        TIMESTAMPTZ NOT NULL,  -- Monday, UTC (mondayOf(), pipeline.ts:246)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT search_query_performance_url_query_week_key UNIQUE (url, query, week_of)
);
CREATE INDEX sqp_week_idx        ON search_query_performance (week_of);
CREATE INDEX sqp_query_idx       ON search_query_performance (query);
CREATE INDEX sqp_family_week_idx ON search_query_performance (page_family, week_of);
CREATE INDEX sqp_position_idx    ON search_query_performance (avg_position)
  WHERE avg_position IS NOT NULL;
CREATE INDEX sqp_url_week_idx    ON search_query_performance (url, week_of);
```

Design notes:
- **Unique key `(url, query, week_of)`** mirrors `search_intelligence`'s
  `@@unique([url, weekOf])`, so the same idempotent `upsert` pattern applies — re-running a week
  is safe (a platform invariant).
- **`page_family` is denormalised deliberately.** Every analysis filters by family; deriving it
  from `url` at query time would prevent index use across what will be the largest table in the
  SEO surface.
- **Volume estimate is deliberately not given.** It is *pages × queries × weeks* and depends on
  production row counts nobody can see from code. Before applying, run V-9 (`02`) plus a
  one-week trial pull and measure. If growth is material, add a retention policy — e.g. keep
  weekly rows 26 weeks, then roll up to monthly — rather than pruning ad hoc.
- **RLS:** this table holds no PII. Follow the project's existing posture for admin-only
  analytics tables (`autolenis-supabase-postgres`); it should not be readable by the anon role.

### 1.5 Refresh cadence — extend the existing cron, add none

| Job | Schedule | Change |
| --- | --- | --- |
| `/api/cron/amips-search-sync` | `0 5 * * 1` (**existing**) | extend: after the page-level sync, run a second `dimensions:["page","query"]` pull with `startRow` pagination into `search_query_performance` |
| `/api/cron/analytics-refresh` | `0 2 * * *` (**existing**) | extend: call `reconcileContentConversions()` (`06`, I-8) |

Both stay inside `withCronRun()` so `cron_job_logs` records duration and outcome. **No new cron
entry is proposed.** `maxDuration = 300` is already set (`route.ts:19`); if paginated pulls
approach that, split the query pull into its own handler rather than raising the ceiling.

Two dimensions, not more: adding `device` or `country` multiplies rows without answering any
question in Part 2. Add them only when a question needs them.

### 1.6 Backfill strategy
GSC retains 16 months; **the current design can reach none of it** — the cron always targets last
week (`route.ts:26-28`) and there is no manual invocation path.

1. **Add a backfill endpoint.** `POST /api/admin/seo/gsc-backfill { weekOf }`, gated with
   `getAdminWithRole(request, OPERATIONAL_ROLES)` — the primitive already used by the keyword
   routes (`07`, A-9…A-12). This also closes the CLAUDE.md rule that *every background job has a
   manual backfill endpoint*, which this job currently violates (`02`).
2. **Walk backwards** one ISO week at a time, most recent first, so the useful window lands
   first and an interruption leaves a contiguous recent history.
3. **Rate-govern** against the daily quota (1.3): a small fixed number of weeks per invocation,
   resumable, driven by the existing `mondayOf()` helper.
4. **Idempotent throughout** — the unique key makes re-running a week a no-op-by-upsert.
5. **Backfill `search_intelligence` too**, using the same endpoint with the existing page-level
   path, so page and query history start from the same date.

### 1.7 Failure handling — fix the silent-degradation pattern
Today every failure path returns `{ synced: 0 }` and the cron reports `success: true`
(`pipeline.ts:49-51,60-63,90-93,158-161`; `route.ts:54-57`). **A dead credential and a quiet week
are indistinguishable.**

| Condition | Today | Required |
| --- | --- | --- |
| `GOOGLE_SEARCH_CONSOLE_KEY` missing | `warn`, success | **fail the `withCronRun` step** so `cron_job_logs` records a failure and alerting fires |
| Token exchange 4xx | `warn`, success | fail — a 401/403 is a real outage |
| Query 403 (property/permission) | `warn`, success | fail, and surface the property string in the message — the single most likely misconfiguration |
| Query 429 (quota) | `warn`, success | retry with backoff (the platform's 8s/16s/32s pattern), then fail |
| Transient 5xx | `warn`, success | retry, then fail |
| Zero rows returned | `info`, success | **success with `rowCount: 0`** — genuinely valid |
| URL with no `AmipsPage` | silent `continue` (`:192`) | count and log — silently dropping known URLs hides slug drift |
| Per-row upsert error | `logger.error`, run continues | keep, but return an error count so partial failure is visible |

The distinction that matters: **"no data" and "could not fetch data" must never look the same.**
That single rule is what separates a trustworthy SEO system from the seven findings in `01`.

---

## Part 2 — The operating model this unlocks

Every analysis below is **deterministic, documented, and evidence-exposing**. No opaque AI
opportunity scores. Each opportunity renders the rows it was computed from.

### 2.1 Four analyses — explicit formulas

Let a row be `(url, query, page_family, impressions, clicks, ctr, avg_position, week_of)` and
`W` the most recent complete week.

**A. Striking distance** — queries ranking just below meaningful traffic.
```
candidates = rows WHERE week_of = W
               AND avg_position BETWEEN 8.0 AND 20.0
               AND impressions >= MIN_IMPRESSIONS      -- config, default 50
priority   = impressions × (position_ceiling − avg_position)   -- position_ceiling = 20.0
```
Rationale: impressions measure demand; the gap to the ceiling measures headroom. Both are
observed. **Evidence shown:** the four field values, the 4-week trend of `avg_position`, and the
URL. Nothing else.

**B. Low CTR** — ranking well, under-clicked. Compared against **this site's own** CTR-by-position
curve, never an external industry table:
```
expected_ctr(p) = median(ctr) over rows WHERE round(avg_position) = round(p)
                                         AND week_of BETWEEN W−12 AND W
deficit = expected_ctr(avg_position) − ctr
flag WHERE avg_position <= 10 AND impressions >= MIN_IMPRESSIONS AND deficit > 0.02
```
Using our own curve keeps the baseline empirical. **Evidence shown:** actual vs expected CTR, the
position bucket, the bucket's sample size (suppress the flag below ~30 samples), and the page's
current `<title>`/description.

**C. Decline** — comparing two equal, non-overlapping windows:
```
recent = Σ clicks over weeks W−3 … W          (4 weeks)
prior  = Σ clicks over weeks W−7 … W−4        (4 weeks)
flag WHERE prior >= MIN_CLICKS                -- config, default 20
       AND (prior − recent) / prior >= 0.30
```
Four-week windows damp weekly noise; the `MIN_CLICKS` floor prevents 3→1 clicks reading as a
67% collapse. **Evidence shown:** both window totals, the weekly series, and position change
across the same windows.

**D. Cannibalization** — two URLs competing for one query:
```
group rows by (query, week_of = W) having count(DISTINCT url) > 1
flag WHERE the top-2 URLs by impressions BOTH have impressions >= MIN_IMPRESSIONS
       AND abs(avg_position_1 − avg_position_2) <= 5.0
```
The position-proximity condition is what distinguishes genuine competition from a strong page
plus an incidental mention. **Evidence shown:** every competing URL with its impressions, clicks
and position; plus each page's family, so the common city-page-vs-guide-page overlap is visible
immediately.

**Configuration, not magic numbers.** `MIN_IMPRESSIONS`, `MIN_CLICKS`, the position band, the
CTR deficit and the decline threshold are operator-tunable and displayed alongside every result.
An operator must always be able to answer *"why is this on the list?"* by reading the screen.

### 2.2 Opportunity → action: the handoff already exists
Per `06-content-conversion.md`, **no second content engine.** An accepted opportunity becomes:

| Target family | Existing on-ramp |
| --- | --- |
| `/intelligence/*` | a `ContentQueue` row (`priorityScore`, `contentTier`, `keywordTarget`) → `amips-generate` picks it up |
| `/buying-guide/*` | `POST /api/admin/content/articles/generate` (`content.generate`) → `ContentGenerationJob` |
| Existing page (title/description fix) | `PATCH /api/admin/content/articles/[id]` — **after AUTHZ-2 is fixed** (`07`) |

The one missing piece is a **write path to `ContentQueue`** — today it is seeded in code only
(`content-queue.seed.ts`), so an operator cannot act on an opportunity without a deploy. That is
the single new endpoint this design needs, and it extends an existing table.

### 2.3 Closing the demand loop
Once `search_query_performance` exists, `reprioritizeContentQueue()`
(`amips-search-sync/route.ts:40`) can score the backlog from **observed query demand** instead of
population estimates — which is exactly what `ContentQueue`'s own schema comment anticipates
(*"later upgraded to search-demand-based once Search Intelligence matures"*). The design was
always intended to arrive here. Note its `buyerValue` term stays inert until defect 0.1 is fixed.

---

## Part 3 — Coverage against automotive purchase intent

**These are categories to investigate against real evidence, not authorization to invent
keywords, volumes, difficulty or opportunity scores.** No number below is a search volume; every
cell is a structural statement about what exists in the repository.

| Intent category | Current coverage | Evidence | Gap |
| --- | --- | --- | --- |
| Car-buying service / concierge | **strong** | `/car-buying-service/*` (104 cities + TX hub); pillar `car-buying-concierge-service` | none structurally |
| City-level local | **strong, but 1 of 21 states has a hub** | 104 cities across 21 states; only Texas has a state hub (`[city]/page.tsx:93-94` renders other states as non-linked crumbs) | **20 state hubs missing** |
| Metro-level | **absent** | `SeoLocation.metro` exists; `METRO_UNIVERSE = 25` assumed (`executive-intelligence.ts:27`); no `/car-buying-service/[metro]` route | metro tier missing |
| State-level | **1 of 21** | `/car-buying-service/texas` only | as above |
| Make | present, ungated | `/cars/[make]`, no quality gate (`05`, R-4) | needs a gate, not more pages |
| Model / make+model | present, ungated, capped | `/cars/[make]/[model]`; sitemap `take:200` (`sitemap.ts:127`) | cap + gate |
| **Make + model + location** | **absent** | no such route | **the highest-intent shape is uncovered** |
| Out-the-door pricing | partial | `otd_price` is a `ContentArticle` cluster; AMIPS market scores | no dedicated hub |
| Dealer fees | **strong** | pillar `dealer-fees-complete-guide`; `/tools/dealer-fee-calculator`; `dealer_fees` cluster; Contract Shield | none |
| Negotiation | **strong** | pillar `how-to-negotiate-car-price`; `negotiation` cluster | none |
| Trade-in | present | pillar `car-trade-in-value-guide`; `trade_in` cluster | no calculator (fee calculator is the proven pattern) |
| Prequalification education | thin | `/legal/prequal-consent`; buyer flow | no educational content family |
| Comparisons | **weak** | `/compare` exists, **absent from the sitemap** (`03`, F-17) | add to sitemap; consider a comparison family |
| Dealership alternatives | partial | `ComparisonTable` on city pages | no standalone family |
| Leasing | present | pillar `lease-vs-buy-car`; `leasing` cluster | none |
| Refinance | present | `/refinance/*` (4 pages, 1 in sitemap, 3 lack metadata — `04`, T-3) | metadata + sitemap |
| Long-tail transactional | AMIPS's purpose | `/intelligence/*`, tiers A–F | **orphaned (`04`, T-7) and self-destructing (0.1)** |

**Highest-leverage structural gaps, in order:**
1. **Fix 0.1** — stop losing the long-tail family that already exists.
2. **State hubs for the other 20 states** — 94 city pages currently have no state parent, and the
   template is proven (`car-buying-service/texas`). Pure reuse.
3. **Un-orphan `/intelligence/*`** (`04`, T-7) — build the `/intelligence` index the admin button
   already links to, and cross-link to city and make/model pages.
4. **Metro tier** — the data model already carries `metro`; it sits between the state hub and the
   city page and is a genuine query shape.
5. **Make+model+location** — the highest-intent shape, entirely absent. Build it **only** with
   R-4's quality gate in place, or it becomes the largest thin-content surface in the system.

**Sequencing principle: fix the gates before adding families.** Every new programmatic family
inherits whichever uniqueness gate governs it, and today all three gates share one blind spot —
they compare pages only within the same location token (`05`, cross-cutting).

---

## Part 4 — Before → after capability map

**Capability-level, not name-level. No working capability is dropped.** Reconciled against the
**VERIFIED current admin navigation**, read from `lib/admin/nav.ts`:

> **67 rail entries** = 3 in the pinned `HOME_SECTION` ("Today", lines 56-63) + **64** across
> **10 collapsible `NAV_SECTIONS`** (lines 72-200): Pipeline 9, Dealers 3, Affiliates 3, Money 3,
> Exceptions & Compliance 10, Engage 14, Inventory 5, Growth 8, Insights 3, Settings 6.
> Of the 67, **66 are under `/admin`**; one (`/status`) is public.
> Plus 38 `HUB_PARENTS`, 29 `DETAIL_PARENTS`, 4 `LEGACY_REDIRECTS`, 3 `AUTH_ROUTES`,
> 1 `EXTERNAL_ENTRY_ROUTES`. **66 + 38 + 29 + 4 + 3 + 1 = 141 = the 141 `app/admin/**/page.tsx`
> files on disk — an exact reconciliation.**
>
> Both figures circulating in prior summaries were treated as unverified and neither was used as
> a baseline. This count was read from the configuration in this session.

SEO today occupies **one rail entry** — "SEO" → `/admin/seo`, in **Growth**
(`lib/admin/nav.ts:174`) — with 4 HUB children (lines 246-249).

| # | Capability | Old location | New location | New access path | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | SEO section entry point | rail "SEO" → `/admin/seo` (`nav.ts:174`) | **unchanged** | Growth → SEO | **kept** |
| 2 | Browse tracked keywords | `/admin/seo/keywords` | `/admin/seo/keywords` | SEO → Keywords | **kept** |
| 3 | Create/update/deactivate keyword (API) | `/api/admin/seo/keywords[/[id]]` | unchanged | same | **kept** — already correctly authorized (`07`) |
| 4 | View page metadata inventory | `/admin/seo/health` (STATIC, `01`/C-3) | `/admin/seo/pages` | SEO → Pages | **kept + repaired** — read the 57 real routes, not a 28-entry constant |
| 5 | View SEO page configs | `/admin/seo/pages` (BROKEN, always empty) | merged into #4 | SEO → Pages | **kept in intent** — the empty table is retired only if V-1 confirms 0 rows |
| 6 | View JSON-LD per page | `/admin/seo/schema` (BROKEN, always empty) | `/admin/seo/schema` | SEO → Schema | **kept + repaired** — read the real builders in `lib/seo/jsonld.tsx` |
| 7 | Health score per page | `healthScore` (never computable, `01`/C-4) | `/admin/seo/pages` health column | SEO → Pages | **kept in intent, formula replaced** — presence-tally → real checks (title/description length, canonical, indexability, metadata presence) |
| 8 | Run a full SEO audit | **advertised, does not exist** (`01`/C-2) | `/admin/seo/pages` → "Run audit" | SEO → Pages | **NEW — makes an advertised capability real** |
| 9 | Page-level GSC performance | `/admin/amips`, `/admin/amips/report` | unchanged | Growth → AMIPS | **kept** |
| 10 | Indexation gate (advisory) | AMIPS dashboard (inert, `01`/C-8) | unchanged, **relabelled** | Growth → AMIPS | **kept** — relabel "decision" → "recommendation" until it governs generation |
| 11 | AMIPS lifecycle management | `amips-lifecycle` cron | unchanged | cron | **kept — defect 0.1 fixed first** |
| 12 | Content generation + publishing | `/admin/content*` | unchanged | Growth → Content Engine | **kept** |
| 13 | Content attribution reporting | `/admin/content/attribution` | unchanged | Content Engine → Attribution | **kept** |
| 14 | Bulk article status | `/admin/content/bulk` | unchanged | Content Engine → Bulk | **kept — AUTHZ-1/2 fixed** |
| 15 | Sitemap / robots generation | route handlers | unchanged | public | **kept** — no admin mutation surface, deliberately (`07`) |
| 16 | **Query-level performance** | **does not exist** | `/admin/seo/queries` | SEO → Queries | **NEW** (Part 1) |
| 17 | **Opportunities (A–D)** | **does not exist** | `/admin/seo/opportunities` | SEO → Opportunities | **NEW** (Part 2.1) |
| 18 | **Opportunity → content queue** | **does not exist** | action on #17 | Opportunities → "Queue content" | **NEW** — writes `ContentQueue`, no new engine (Part 2.2) |
| 19 | **GSC backfill** | **does not exist** | `POST /api/admin/seo/gsc-backfill` | SEO → Pages → Backfill | **NEW** (Part 1.6) |

**Navigation impact: the SEO rail entry count does not change.** `/admin/seo` remains one rail
entry in Growth; its HUB children go from 4 to 6 (adding `queries`, `opportunities`). Under
`HUB_PARENTS` (`nav.ts:246-249`) each new child declares `/admin/seo` as parent and the
capability-preservation test (`lib/admin/__tests__/nav-capability-preservation.test.ts`) asserts
the link genuinely exists. **Rail entries stay at 67; admin pages go 141 → 143.**

**Nothing is classified as a duplicate by name.** `/admin/seo/health` and `/admin/seo/pages`
overlap in *capability* (both describe per-page metadata state) — one reads a hardcoded constant,
the other an empty table. Merging them into one working surface preserves both capabilities and
removes neither. If V-1/V-2 return non-zero row counts, `seo_page_configs` has an out-of-band
writer and #5 must be preserved as a distinct surface instead.

---

## Part 5 — Sequencing

| Phase | Work | Rationale |
| --- | --- | --- |
| **0** | Defects 0.1, 0.1b, 0.1c, 0.2, 0.3 | Stop active damage. 0.1 first — 76.7% of the corpus 404s today. **0.1c must ship before or with Phase 1/2, which would otherwise arm it** |
| **0b** | AUTHZ-1, AUTHZ-2 (`07`) | Two one-line changes using primitives that already exist |
| **1** | Remove the `/intelligence/` filter (`pipeline.ts:172`) | Immediately extends real GSC coverage from 1 family to all — **no schema change** |
| **2** | `search_query_performance` + paginated `["page","query"]` pull + failure handling (1.7) | The data foundation. DDL to owner for approval first |
| **3** | Backfill endpoint (1.6) + 16-month walk | Trend analyses need history before they mean anything |
| **4** | `/admin/seo/queries`, then `/admin/seo/opportunities` (A–D) | Only once ≥8 weeks of query data exists — the windows in 2.1 require it |
| **5** | `ContentQueue` write path (2.2) | Closes opportunity → content |
| **6** | Attribution gaps I-3…I-6 (`06`) | Makes conversion measurable across the footprint |
| **7** | State hubs (×20), `/intelligence` index, metro tier | Coverage expansion — **only after the gates are fixed** |
| **8** | GA4 loader (`06`, I-2) | Valuable, but the DB chain already answers the revenue question; funnel diagnosis is the incremental gain |

**Phase 1 is the highest value-to-effort step in this document:** deleting one filter condition
multiplies real GSC coverage across every page family, with no schema change and no new
infrastructure.

---

## Google documentation — **UNVERIFIED-AGAINST-LIVE-DOCS**

No network access was used in this session. The following is cited from knowledge as of the
training cutoff and **must be re-verified against live documentation** before implementation.

| Topic | Reference to verify |
| --- | --- |
| Search Analytics API (dimensions, `startRow`, row limits) | `developers.google.com/webmaster-tools/v1/searchanalytics/query` |
| API limits and quotas | `developers.google.com/webmaster-tools/limits` |
| Scaled content abuse; doorway pages | `developers.google.com/search/docs/essentials/spam-policies` |
| Helpful, reliable, people-first content | `developers.google.com/search/docs/fundamentals/creating-helpful-content` |
| Sitemap size limits (50 000 URLs / 50 MB uncompressed) | `developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap` |
| Canonicalization | `developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls` |
| `robots.txt` vs `noindex` — `Disallow` prevents crawling, not indexing | `developers.google.com/search/docs/crawling-indexing/block-indexing` |

### Conflicts between current AutoLenis logic and current guidance — documented, not rewritten

| # | Conflict | Where | Note |
| --- | --- | --- | --- |
| G-1 | Private portals rely on `robots.txt` `Disallow` alone; guidance is that this prevents crawling, not indexing | `app/robots.ts:9`; no `X-Robots-Tag` in `proxy.ts` | Low risk (auth-gated). See `04`, T-9. **Not proposed as a rewrite** |
| G-2 | `<priority>` and `<changefreq>` are set throughout; Google has stated it ignores both | `app/sitemap.ts:15-59`; `lib/amips/sitemap.ts:14-19` | Harmless and valid sitemap XML; other engines may use them. **No change proposed** |
| G-3 | The same URLs are submitted in two declared sitemaps | `robots.ts:33,35` | Google dedupes, so not an indexing bug — but it defeats per-tier tracking. See `04`, T-4 |
| G-4 | No AI-generation disclosure on LLM-generated families | `/intelligence/*`, `/buying-guide/*` | Guidance does not require disclosure but emphasises human-value assessment. AMIPS Gate 1's real-data-token requirement is a strong existing answer. **Owner decision, not a defect** |
| G-5 | `localBusinessSchema` asserts `areaServed: Texas` on national pages | `lib/seo/jsonld.tsx:83` | Structured-data accuracy conflict. See `04`, T-10 — this one **is** a defect |

Where existing logic conflicts with guidance, it is recorded above rather than silently changed.
G-1, G-2 and G-4 are owner decisions; G-3 and G-5 are defects with remediations in `04`.
