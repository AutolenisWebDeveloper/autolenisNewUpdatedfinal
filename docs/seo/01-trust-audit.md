# 01 — Trust Audit of the Existing SEO Surface

**Scope:** every route under `/admin/seo`, plus the AMIPS and content surfaces elsewhere in
`/admin` that render SEO metrics. Every value an operator sees is traced to its actual source.

**Method:** route manifest built from `frontend/app/**` (903 `page.tsx`/`route.ts` files), then
targeted call-graph tracing of every read and every write. Paths are relative to `frontend/`.

**Classification key:** REAL · DERIVED · STATIC · MOCK · SYNTHETIC · BROKEN

---

## Headline result

| Result | Count |
| --- | --- |
| CRITICAL findings (STATIC/BROKEN value shown to an operator as a real measurement) | **7** |
| Fabricated data (MOCK / SYNTHETIC / randomized) found anywhere in the SEO surface | **0** |
| `/admin/seo` routes | 5 |
| `/admin/seo` API routes | 2 |

**VERIFIED — the codebase does not fabricate SEO metrics.** A scan of
`app/admin/{amips,content,seo}`, `app/api/admin/{amips,content,seo}`, `lib/amips`, `lib/seo`,
`lib/services/{seo,content}` and `lib/analytics` for `Math.random`, `MOCK_`, `DEMO_`, `fakeData`,
`sampleData` and `seededRandom` returned **no matches outside tests**. No randomized or
placeholder number is presented as a measurement anywhere.

The trust problem is a different and more subtle one: **values that are structurally incapable of
ever being populated, rendered in UI that implies they are live.** Seven such values follow.

---

## CRITICAL findings — individually

### C-1 · `seo_page_configs` has no reachable writer — the table is permanently empty
**Severity: CRITICAL · Classification: BROKEN**

Three functions write `seoPageConfig`. **All three have zero callers** in `app/`, `lib/`,
`components/`, `scripts/`, `prisma/` (verified by full-repo grep for each identifier):

| Writer | Definition | Callers |
| --- | --- | --- |
| `upsertPageConfig()` | `lib/services/seo/seo.service.ts:6` | **none** |
| `savePageSchema()` | `lib/services/seo/seo-schema.service.ts:23` | **none** |
| `computeHealthScore()` (writes `healthScore`, `lastAuditAt`) | `lib/services/seo/seo.service.ts:25,35` | only `auditAllPages()` — itself uncalled (C-2) |

No seed script, no migration insert, no admin route, no cron writes this table.

**Operator impact:** `/admin/seo/pages` (`app/admin/seo/pages/page.tsx:6-7`) renders
`SEO Page Configs ({configs.length})` — this reads `getAllPageConfigs()`
(`lib/services/seo/seo.service.ts:21`) and can only ever render **0**. An operator reading
"SEO Page Configs (0)" reasonably concludes AutoLenis has no SEO configuration, when in fact
all real metadata lives in code (`lib/seo/metadata.ts`) and this table is vestigial.

---

### C-2 · The SEO audit is unreachable — health scores can never be computed
**Severity: CRITICAL · Classification: BROKEN**

`auditAllPages()` (`lib/services/seo/seo-audit.service.ts:5`) is the only producer of
`seo_health_scores` rows and the only caller of `computeHealthScore()`. **It has zero callers.**
There is no admin route, no cron entry in `vercel.json` (67 crons enumerated — none invoke it),
and no script that triggers an SEO audit.

`/admin/seo/health` tells the operator, at `app/admin/seo/health/page.tsx:53`:

> "Run a full audit to capture per-page health scores."

**There is no way to run it.** No UI control, no endpoint, no job. The instruction describes a
capability that does not exist.

---

### C-3 · `/admin/seo/health` renders a hardcoded constant under a "Health" heading
**Severity: CRITICAL · Classification: STATIC**

`app/admin/seo/health/page.tsx:2,15` imports `PAGE_METADATA` from `lib/seo/metadata.ts` — a
hardcoded TypeScript object literal (28 entries, verified) — and renders it as
`SEO Health — {pages.length} Pages` (line 21).

| Column rendered | Source | Class |
| --- | --- | --- |
| Key, Title, Description, Path | `lib/seo/metadata.ts` object literal | **STATIC** |
| Keywords (count) | `meta.keywords?.length ?? 0` — length of a hardcoded array | **STATIC** |

No health score, no issue count, no audit date, and no live check appear on the page despite its
name. The page is honest in one respect — line 24 labels the source as `lib/seo/metadata.ts` —
but the `<h1>` "SEO Health" and the line-52 claim that *"Each page has title, description,
canonical URL, OpenGraph tags, and Twitter card metadata"* are asserted, never verified against
the 57 public routes that actually exist. **Four public pages have no metadata export at all**
(see `04-technical-findings.md`, T-3), which this page cannot reveal.

---

### C-4 · `healthScore` is a metadata-presence tally, not an SEO health measurement
**Severity: CRITICAL · Classification: DERIVED (inert)**

`app/admin/seo/pages/page.tsx:7` renders `{c.healthScore}/100` — visually a health score out of
100. The formula (`lib/services/seo/seo.service.ts:29-34`) is:

```
score = 0
+25 if config.title        +25 if config.description
+25 if config.ogTitle && config.ogDescription
+25 if config.schema
```

This measures only *whether four DB columns are non-null*. It does not check title length,
description length, canonical correctness, indexability, duplication, or anything a search
engine evaluates. A page scoring **100/100** may be non-indexable, duplicate, and orphaned.

Compounding this: because of C-1/C-2 the field is never written, so `healthScore` is always
`null` and the `{c.healthScore !== null && ...}` guard means **the score never renders at all**.
The formula's weakness is latent today and becomes an active misinformation risk the moment
anyone wires up a writer.

---

### C-5 · Keyword `searchVolume` is operator-typed, displayed as if measured
**Severity: CRITICAL · Classification: STATIC (operator-entered)**

`app/admin/seo/keywords/page.tsx:7` renders `{k.searchVolume.toLocaleString()} vol`.

`searchVolume` originates **only** from the request body of
`POST /api/admin/seo/keywords` (`app/api/admin/seo/keywords/route.ts:19,38`) or
`PATCH .../[id]` (`app/api/admin/seo/keywords/[id]/route.ts:11,32`). Zod validates it as
`z.number().int().min(0).optional()` — any integer is accepted. **No keyword-research provider
is integrated anywhere in the repository** (see `02-data-sources.md`, D-6). `difficulty`
(0–100) has the same provenance.

The rendered string `"12,000 vol"` is indistinguishable from a measured search volume. It is
whatever an admin typed. There is no source field, no `as-of` date, and no provider attribution
on the record (`prisma/schema.prisma:2248-2258`).

---

### C-6 · `leadsGenerated`, `conversionRate` and `revenueAttribution` are never written — permanently zero
**Severity: CRITICAL · Classification: BROKEN**

`AmipsPage.leadsGenerated` (`prisma/schema.prisma:4784`) is read in at least 11 places but
**written in none**. Every write to `amipsPage` was enumerated:

| Write site | Sets `leadsGenerated`? |
| --- | --- |
| `lib/amips/amips-generator.ts:203` (upsert) | no — defaults to `0` |
| `lib/amips/pipelines/search-intelligence.pipeline.ts:230` | no — sets `impressions`, `clicks` only |
| `lib/amips/lifecycle-manager.ts:186,204,225` | no — sets `lifecycleStatus` only |

Consequences, all VERIFIED by tracing the value:

| Derived value | Site | Actual value |
| --- | --- | --- |
| `SearchIntelligence.leadsGenerated` | `search-intelligence.pipeline.ts:198,212,223` (`leads = page.leadsGenerated`) | always `0` |
| `SearchIntelligence.conversionRate` | `search-intelligence.pipeline.ts:199` (`clicks > 0 ? leads/clicks : null`) | always `0` when clicks > 0 |
| `SearchIntelligence.revenueAttribution` | schema default `0`; no writer found | always `0` |
| AMIPS dashboard **"Leads"** | `app/admin/amips/report/page.tsx:118` ← `executive-intelligence.ts:544` | always `0` |
| AMIPS dashboard **"Revenue run-rate"** | `app/admin/amips/report/page.tsx:120` ← `executive-intelligence.ts:546` | always `$0` |
| Content-queue re-prioritizer `buyerValue` | `lib/amips/seed/content-queue.seed.ts:428` (`Math.max(1, page.leadsGenerated)`) | always `1` — the term is inert |

An operator reading the AMIPS report sees **Leads: 0** and **Revenue run-rate: $0** next to real,
non-zero impressions and clicks. The natural conclusion — "our SEO content converts nobody" — is
not supported by the data; the metric is simply never recorded.

---

### C-7 · The zero-leads defect actively de-indexes AutoLenis's best-performing pages
**Severity: CRITICAL — highest business impact in this audit · Classification: BROKEN**

This is C-6 turned into a live production feedback loop.

`lib/amips/lifecycle-manager.ts:196-201`:
```ts
const conversion = p.clicks > 0 ? p.leadsGenerated / p.clicks : null;
const lowConversion =
  pubAge !== null && pubAge >= LOW_CONVERSION_DAYS &&   // 90 days (line 34)
  conversion !== null && conversion < LOW_CONVERSION_THRESHOLD;  // 0.001 (line 36)
```

Because `leadsGenerated` is always `0` (C-6), `conversion` evaluates to **exactly `0`** for any
page with at least one click, and `0 < 0.001` is always true.

The precise trigger, traced through the full `ACTIVE` branch (`lifecycle-manager.ts:177-210`):

| Condition | Source |
| --- | --- |
| `lifecycleStatus === "ACTIVE"` | line 177 |
| **not** stale, **and** has impressions in the last 180 days — otherwise it takes the earlier `REFRESH_REQUIRED` branch and `continue`s | lines 179-192 |
| `pubAge >= 90` days | line 199 (`LOW_CONVERSION_DAYS`) |
| `p.clicks > 0` — note `amipsPage.clicks` holds the **most recently synced GSC week's** total, not a cumulative count (`search-intelligence.pipeline.ts:230-233`) | line 196 |

> **Any ACTIVE AMIPS page ≥90 days old, with fresh data, that recorded at least one click in the
> most recently synced week, is flagged `UNDER_REVIEW`.** A page with *zero* clicks that week
> yields `conversion === null` and is **spared**.

The lifecycle review runs weekly — `vercel.json` cron `/api/cron/amips-lifecycle` at `0 4 * * 2`
(VERIFIED) → `lib/amips/lifecycle-manager.ts:204` sets `lifecycleStatus: "UNDER_REVIEW"`.

`UNDER_REVIEW` is not a soft flag. It removes the page from the public internet:

| Surface | Filter | Effect on `UNDER_REVIEW` |
| --- | --- | --- |
| `/intelligence/[slug]` page | `app/(public)/intelligence/[slug]/page.tsx:38` `where: { slug, lifecycleStatus: "ACTIVE" }` → `notFound()` line 91 | **serves HTTP 404** |
| `sitemap-amips-{a..d}.xml` | `lib/amips/sitemap.ts:51` `lifecycleStatus: "ACTIVE"` | **dropped** |
| `sitemap-intelligence.xml` | `app/sitemap-intelligence.xml/route.ts:33` | **dropped** |

**Net effect: the better an AMIPS page performs in organic search, the sooner it is 404'd and
removed from every sitemap. Pages that attract no traffic at all survive indefinitely.** This
inverts the intended lifecycle policy and destroys accumulated ranking equity, link equity and
crawl history for exactly the pages worth keeping.

This is a code-provable defect requiring no live data to confirm. It is the single
highest-priority remediation in this audit.

---

## Full per-value classification table

### `/admin/seo` — route inventory

| Route | File | Auth | Values rendered |
| --- | --- | --- | --- |
| `/admin/seo` | `app/admin/seo/page.tsx:2` | `requireAdmin()` | 4 static nav tiles — no metrics |
| `/admin/seo/pages` | `app/admin/seo/pages/page.tsx` | `requireAdmin()` | config count, `pageSlug`, `healthScore`, `title` |
| `/admin/seo/health` | `app/admin/seo/health/page.tsx` | `requireAdmin()` | page count, title, description, path, keyword count |
| `/admin/seo/keywords` | `app/admin/seo/keywords/page.tsx` | `requireAdmin()` | keyword count, `keyword`, `searchVolume` |
| `/admin/seo/schema` | `app/admin/seo/schema/page.tsx` | `requireAdmin()` | `pageSlug`, JSON-LD blob |

None of the five carries a rail entry; all four leaves are HUB children of `/admin/seo`
(`lib/admin/nav.ts:246-249`). `/admin/seo` itself is rail entry **"SEO"** in section **Growth**
(`lib/admin/nav.ts:174`).

### Per-value classification

| # | Value as displayed | File:line | Source | Class | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | `SEO Page Configs (N)` | `admin/seo/pages/page.tsx:7` | `seoPageConfig.findMany` | **BROKEN** | always 0 — C-1 |
| 2 | `{healthScore}/100` | `admin/seo/pages/page.tsx:7` | `seoPageConfig.healthScore` | **BROKEN** | never written — C-1, C-4 |
| 3 | `c.pageSlug`, `c.title` | `admin/seo/pages/page.tsx:7` | `seoPageConfig` | **BROKEN** | no rows exist |
| 4 | `SEO Health — N Pages` | `admin/seo/health/page.tsx:21` | `PAGE_METADATA` literal | **STATIC** | C-3 |
| 5 | Title / Description / Path | `admin/seo/health/page.tsx:42-44` | `lib/seo/metadata.ts` | **STATIC** | C-3 |
| 6 | Keywords count | `admin/seo/health/page.tsx:45` | hardcoded array `.length` | **STATIC** | C-3 |
| 7 | "Each page has title, description, canonical…" | `admin/seo/health/page.tsx:52` | prose assertion | **STATIC** | unverified claim; 4 pages lack metadata |
| 8 | "Run a full audit…" | `admin/seo/health/page.tsx:53` | prose | **BROKEN** | no trigger exists — C-2 |
| 9 | `SEO Keywords (N)` | `admin/seo/keywords/page.tsx:7` | `seoKeyword.findMany` | **REAL** | genuine row count |
| 10 | `k.keyword` | `admin/seo/keywords/page.tsx:7` | `seoKeyword.keyword` | **REAL** | operator-entered, honest |
| 11 | `{searchVolume} vol` | `admin/seo/keywords/page.tsx:7` | request body | **STATIC** | C-5 |
| 12 | JSON-LD viewer rows | `admin/seo/schema/page.tsx:9-13` | `seoPageConfig.schema` | **BROKEN** | always empty — C-1 |
| 13 | "Schema is managed in code (lib/seo)" | `admin/seo/schema/page.tsx:13` | prose | **REAL** | accurate — real JSON-LD is in `lib/seo/jsonld.tsx` |

**Note on #12/#13:** the schema page is *self-aware* — it correctly tells the operator schema
lives in code. The `Prisma.DbNull` filter at line 10 was a deliberate correctness fix (see the
comment at lines 7-8). The page is honest; it is merely reading a table nothing populates.

### AMIPS surface (`/admin/amips`, `/admin/amips/report`)

| # | Value | File:line | Source | Class |
| --- | --- | --- | --- | --- |
| 14 | Impressions | `executive-intelligence.ts:540` | `searchIntelligence._sum.searchImpressions` ← GSC | **REAL** |
| 15 | Clicks | `executive-intelligence.ts:541` | `searchIntelligence._sum.clicks` ← GSC | **REAL** |
| 16 | CTR | `executive-intelligence.ts:542` | `_avg.ctr` ← GSC | **REAL** |
| 17 | Avg position | `executive-intelligence.ts:543` | `_avg.avgPosition` ← GSC | **REAL** |
| 18 | **Leads** | `admin/amips/report/page.tsx:118` | `leadsGenerated` | **BROKEN** — always 0 (C-6) |
| 19 | **Revenue run-rate** | `admin/amips/report/page.tsx:120` | `revenueAttribution × 13` | **BROKEN** — always $0 (C-6) |
| 20 | Top pages → leads / revenue | `executive-intelligence.ts:555-556` | as above | **BROKEN** — always 0 |
| 21 | `projectedNext30d` | `executive-intelligence.ts:539` | `dailyVelocity × 30` | **DERIVED** — formula stated; publish-rate extrapolation, not a forecast of traffic |
| 22 | `indexationRate` | `lib/amips/indexation-gate.ts:49-60` | published pages vs GSC `indexedStatus` | **DERIVED** — real GSC input |
| 23 | `indexationDecision` (scale/hold/pause) | `indexation-gate.ts:31-35` | `decideFromRate` | **DERIVED but INERT** — see C-8 below |
| 24 | `tierMix` | `executive-intelligence.ts:551` | `amipsPage.groupBy` | **REAL** |
| 25 | Coverage % denominators (`METRO_UNIVERSE=25`, `COVERAGE_TARGET_DEALERS=15`, `CONTENT_TARGET_PAGES=10`) | `executive-intelligence.ts:27,33,36` | constants | **STATIC (legitimate)** — business targets used as denominators, not measurements |

### C-8 · The Indexation Gate decides nothing
**Severity: HIGH · Classification: DERIVED but INERT**

`lib/amips/indexation-gate.ts:1-13` documents the gate as throttling generation volume:
`≥70% → scale`, `50–69% → hold`, `<50% → pause`.

**No generation code consults it.** The only callers of `computeIndexationGates` /
`decideFromRate` are in `lib/amips/intelligence/executive-intelligence.ts:393,435` — the
read-only dashboard. `app/api/cron/amips-generate/route.ts:17` uses a hardcoded
`const BATCH_LIMIT = 17` and never reads the gate.

An operator shown **"Indexation decision: pause"** has no reason to know generation is still
running at full rate. The word *decision* implies enforcement that does not exist. (The file's
own header does say "Surfaced read-only in the AMIPS admin dashboard" — the defect is that the
UI vocabulary does not carry that caveat.)

---

## What is genuinely trustworthy

Recorded explicitly so remediation does not damage working systems:

| Capability | Evidence | Class |
| --- | --- | --- |
| GSC impressions/clicks/CTR/position for `/intelligence/*` | `search-intelligence.pipeline.ts:141-233`, cron `0 5 * * 1` | **REAL** |
| Keyword CRUD + audit logging | `api/admin/seo/keywords/route.ts:51-56`; `[id]/route.ts:35-41,58-63` | **REAL** |
| Soft-delete preserves keyword history | `[id]/route.ts:53-57` | **REAL** |
| AMIPS 5-gate content validator | `lib/amips/quality-gate.ts:72-151` | **REAL** (two defects — `05-programmatic-risk.md`) |
| City-page thin-content gate | `lib/seo/locations.ts:2546-2554` + `car-buying-service/[city]/page.tsx:82-84` | **REAL** — genuinely blocks doorway pages |
| Sitemap lifecycle filtering | `lib/amips/sitemap.ts:51`; `app/sitemap.ts:104` | **REAL** |
| JSON-LD generation | `lib/seo/jsonld.tsx` (13 builders) | **REAL** |
| Tier-segmented sitemap casing (`"A"`–`"D"`) | routes pass uppercase; `content-queue.seed.ts:253,266,281` writes uppercase | **REAL** — no case-mismatch defect |

---

## Owner must verify (live checks — not determinable from code)

| # | Check | Why it matters |
| --- | --- | --- |
| V-1 | Query `SELECT count(*) FROM seo_page_configs;` | Confirms C-1: expected **0**. A non-zero count means rows were inserted out-of-band and the audit's reachability conclusion needs revisiting. |
| V-2 | Query `SELECT count(*) FROM seo_health_scores;` | Confirms C-2: expected **0**. |
| V-3 | Query `SELECT count(*), max(search_volume) FROM seo_keywords;` | Sizes the C-5 exposure — how many operator-typed volumes are in play. |
| V-4 | `SELECT count(*) FROM amips_pages WHERE lifecycle_status='UNDER_REVIEW';` and `SELECT count(*) FROM amips_pages WHERE lifecycle_status='ACTIVE' AND published_at < now() - interval '90 days' AND clicks > 0;` | **Sizes the C-7 blast radius** — how many pages have already been 404'd, and how many are next. Run this first. |
| V-5 | `SELECT sum(leads_generated), sum(revenue_attribution) FROM search_intelligence;` | Confirms C-6: expected **0, 0**. |
| V-6 | Confirm `GOOGLE_SEARCH_CONSOLE_KEY` and `GSC_SITE_URL` are present in Vercel **production** | Determines whether items 14–17 and 22 are populated at all. See `02-data-sources.md`. |
