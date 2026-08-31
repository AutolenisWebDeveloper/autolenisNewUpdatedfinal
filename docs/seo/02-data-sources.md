# 02 — Data Source Reality

Every external data source an SEO growth system would depend on, traced to actual code and
configuration. Paths relative to `frontend/`. No live environment was inspected.

**Classification key:** ACTIVE · PARTIAL · DORMANT · UNWIRED · BROKEN · NOT VERIFIED

---

## Summary

| # | Source | Classification | One-line basis |
| --- | --- | --- | --- |
| D-1 | Google Search Console | **PARTIAL** | Real hand-rolled integration on a live weekly cron, but `page` dimension only and scoped to `/intelligence/*` |
| D-2 | Google Analytics 4 | **UNWIRED** | `window.gtag` called in 2 modules; **no GA4/GTM script is ever loaded** — every call is a silent no-op |
| D-3 | Bing Webmaster Tools / IndexNow | **UNWIRED** | No client, no call site, no credential, no verification meta tag |
| D-4 | PageSpeed Insights API / CrUX | **UNWIRED** | Zero references anywhere in the repository |
| D-5 | Rank tracking | **UNWIRED** | No provider; GSC `position` is stored but only per-page, never per-query |
| D-6 | Keyword research (volume/difficulty) | **UNWIRED** | No provider; `seo_keywords` values are operator-typed (see `01`, C-5) |
| D-7 | Backlink data | **UNWIRED** | No provider; no `sameAs` population (`seo-schema.service.ts:11` is `[]`) |
| D-8 | Site crawling | **UNWIRED** | No crawler; Playwright is present for tests only, not wired to any SEO job |
| D-9 | Microsoft Clarity | **NOT VERIFIED** | Loader present and gated on env; behaviour depends on an unreadable env var |
| D-10 | TikTok Pixel | **NOT VERIFIED** | Loader present sitewide; env-gated |

**Net: one PARTIAL source. Seven of the ten are UNWIRED.** No keyword, rank, backlink, crawl or
field-performance data exists anywhere in this system.

---

## D-1 · Google Search Console — **PARTIAL**

The only genuine external SEO data source in the repository.

| Question | Answer | Evidence |
| --- | --- | --- |
| Client/SDK present? | Yes — hand-rolled, no `googleapis` dependency. Service-account JWT signed with `jose`, exchanged for an OAuth token, then plain `fetch`. | `lib/amips/pipelines/search-intelligence.pipeline.ts:19-20,68-100` |
| Call sites present? | Yes — one. `POST searchAnalytics/query` | `search-intelligence.pipeline.ts:141-157` |
| Reachable from a live route or cron? | **Yes** — Vercel cron, Mondays 05:00 UTC | `vercel.json` → `/api/cron/amips-search-sync`, schedule `0 5 * * 1`; handler `app/api/cron/amips-search-sync/route.ts:21-57` |
| Credentials referenced by name | `GOOGLE_SEARCH_CONSOLE_KEY` (base64 service-account JSON), `GSC_SITE_URL` (falls back to `NEXT_PUBLIC_APP_URL`) | `env.d.ts:106-109`; `pipeline.ts:48`; `route.ts:30` |
| Scope requested | `https://www.googleapis.com/auth/webmasters.readonly` | `pipeline.ts:27` |
| Persistence layer | `search_intelligence` (unique on `url + weekOf`), mirrored onto `amips_pages.impressions/clicks` | `prisma/schema.prisma:4673-4695`; `pipeline.ts:202-233` |
| Cron auth | `authorizeCronRequest` — fails **closed** (500) if `CRON_SECRET` unset; constant-time `Bearer` compare | `lib/security/cron-auth.ts:9-11,26-34`; `route.ts:22-23` |
| Job monitoring | Wrapped in `withCronRun("amips-search-sync", …)` → `cron_job_logs` | `route.ts:15,38` |
| Timeouts | 10 s token exchange, 30 s query | `pipeline.ts:88,155` |

### Why PARTIAL, not ACTIVE — four structural limits

**L-1 — No `query` dimension. This is the decisive limit.**
`pipeline.ts:152` requests `dimensions: ["page"]` only. **No keyword/query data is ever
requested or stored.** `search_intelligence` has no query column
(`prisma/schema.prisma:4673-4695`). Every query-level analysis a modern SEO command centre is
built on — striking distance, low-CTR outliers, query decline, cannibalization — is
**impossible against the data as persisted today**. This determines the conditional branch in
`08-proposal.md`.

**L-2 — Scoped to one page family.** `pipeline.ts:30,172` filters rows to URLs containing
`/intelligence/`. The homepage, all 104 `/car-buying-service/*` city pages, the Texas hub,
`/buying-guide/*`, `/cars/*`, `/tools/*` and every other public page are **discarded**, even
though GSC returned them in the same response. ~57 static public routes plus the entire
city/guide/vehicle footprint have zero performance data.

**L-3 — Silently drops URLs with no `AmipsPage` row.** `pipeline.ts:192`
(`if (!page) continue;`) — a `/intelligence/*` URL Google knows about but the DB does not is
skipped with no counter and no log. Retired/renamed slugs vanish from reporting silently.

**L-4 — No pagination.** `rowLimit: 25_000` (`pipeline.ts:153`) with no `startRow` loop. Beyond
25,000 rows in a week, data is truncated with no warning. Not a problem at current scale; it is
a silent cliff.

### Failure handling — degrades quietly by design
Missing key (`pipeline.ts:49-51`), malformed key (`60-63`), failed token exchange (`90-93`),
failed query (`158-161`) all `logger.warn` and `return { synced: 0 }`. The cron then reports
`success: true, synced: 0` (`route.ts:54-57`). **A total credential failure and a genuinely
quiet week are indistinguishable in the cron response.** Per-row errors are logged at `error`
level (`pipeline.ts:236`) but do not fail the run.

### Additional gaps
- **No manual backfill endpoint.** `syncSearchIntelligence` is called from exactly one place
  (the cron). CLAUDE.md's own rule — *"Every background job has a manual backfill endpoint"* —
  is not met here. A missed week cannot be re-pulled without a deploy.
- **No historical backfill.** The cron always targets *last* week (`route.ts:26-28`). GSC
  retains 16 months; none of it can be imported.

### Owner must verify
| # | Exact check | Determines |
| --- | --- | --- |
| V-6 | Confirm `GOOGLE_SEARCH_CONSOLE_KEY` is present in Vercel **production** env | Whether D-1 is running at all |
| V-7 | Confirm `GSC_SITE_URL` is set, and that it exactly matches the GSC property (`sc-domain:autolenis.com` vs `https://autolenis.com/` are different properties) | A mismatch returns 403 → silent `synced: 0` |
| V-8 | In GSC → Settings → Users, confirm the service-account `client_email` is added to the property | Without it the query 403s silently |
| V-9 | `SELECT count(*), max(week_of) FROM search_intelligence;` | Whether any data has ever landed, and whether the cron is current |
| V-10 | `SELECT * FROM cron_job_logs WHERE job_name='amips-search-sync' ORDER BY created_at DESC LIMIT 8;` | Whether the cron fires weekly and its `synced` counts |
| V-11 | Confirm `CRON_SECRET` is set in Vercel production | If unset, **every** cron 500s (fail-closed) — all 67 jobs, not just this one |

---

## D-2 · Google Analytics 4 — **UNWIRED** (critical for conversion measurement)

Two modules emit GA4 events through `window.gtag`:

| Module | Emit site | Events |
| --- | --- | --- |
| `lib/analytics/events.ts` | line 20 | article CTA, calculator steps, scroll depth |
| `lib/analytics/funnel-events.ts` | line 58 | 21 funnel events incl. `lp_form_submit`, `deposit_paid` (lines 7-27) |

**No GA4 or GTM script is ever loaded.** VERIFIED by grepping `app/`, `components/` and
`public/` for `gtag/js`, `googletagmanager.com` and a `G-XXXXXXXXX` measurement id — **zero
matches**. `app/layout.tsx:87-107` loads exactly three third-party scripts: `Clarity` (line 102),
`TikTokPixel` (line 104), `ServiceWorkerRegistration` (line 100). There is no GA4 loader in any
layout or page.

Consequence: `window.gtag` is `undefined`, so `window.gtag?.(…)` (`events.ts:20`,
`funnel-events.ts:58`) **silently no-ops on every call**. `window.dataLayer.push`
(`events.ts:21-22`, `funnel-events.ts:60-61`) appends to an in-memory array no tag manager ever
reads; it is discarded on navigation.

**Every one of the 21 funnel events — including `deposit_paid`, the revenue event — reaches no
analytics destination.** There is no environment variable that could switch this on: no
`NEXT_PUBLIC_GA_ID` or equivalent is declared in `env.d.ts`. This is a code gap, not a config
gap, and it is the root cause of the conversion-measurement break in `06-content-conversion.md`.

*(`funnel-events.ts:59` also calls `window.clarity?.("event", …)`, which does fire when Clarity
loads — see D-9. Clarity records the event for session replay; it is not an attribution store.)*

---

## D-3 · Bing Webmaster Tools / IndexNow — **UNWIRED**
No client, call site, credential, or `msvalidate.01` verification meta tag. `app/robots.ts:29-36`
declares four sitemaps but there is no submission mechanism to any engine. `app/layout.tsx:61-80`
sets no `verification` block. Bing/Yandex receive no indexing signals beyond ordinary crawling.

## D-4 · PageSpeed Insights / CrUX — **UNWIRED**
Grep for `pagespeedonline`, `chromeuxreport`, `crux`, `lighthouse`, `web-vitals`, `webVitals`
across `app/`, `lib/`, `components/`: **zero matches**. No lab or field performance data is
collected, stored, or displayed. No `web-vitals` package is imported.

## D-5 · Rank tracking — **UNWIRED**
No provider. GSC `position` **is** captured (`search_intelligence.avg_position`,
`pipeline.ts:195`) but only as a page-level average across all queries — it cannot answer "where
do we rank for *X*". Per-query ranking requires the `query` dimension (L-1).

## D-6 · Keyword research — **UNWIRED**
Grep for `ahrefs|semrush|moz\.com|dataforseo|serpapi|keywordtool|majestic`: **zero matches**.
`seo_keywords.search_volume` and `.difficulty` are supplied by the admin request body
(`app/api/admin/seo/keywords/route.ts:19-20,38-40`). See `01-trust-audit.md`, C-5.

## D-7 · Backlink data — **UNWIRED**
No provider. `generateOrganizationSchema()` emits `"sameAs": []`
(`lib/services/seo/seo-schema.service.ts:11`) — the entity-graph signal is empty. Note this
function has **zero callers**; the live Organization schema comes from
`components/seo/OrganizationSchema.tsx` (`app/layout.tsx:94`).

## D-8 · Crawling — **UNWIRED**
No crawler, no broken-link checker, no redirect-chain analysis. Playwright is configured
(`playwright.e2e.config.ts`, `playwright.visual.config.ts`) for tests only and is not invoked by
any cron or service. Everything in `04-technical-findings.md` marked *requires crawl
infrastructure* is blocked on this.

## D-9 · Microsoft Clarity — **NOT VERIFIED**
Loaded sitewide at `app/layout.tsx:102`; the comment at line 101 states "production only,
requires `NEXT_PUBLIC_CLARITY_ID`". Whether it is live cannot be determined from code.
`funnel-events.ts:59` forwards funnel events to it. Clarity gives session replay and heatmaps —
useful for on-page diagnosis, **not** a substitute for GA4 attribution: it does not join a
session to a `VehicleRequest`, a deposit, or revenue.
**Owner check V-12:** confirm `NEXT_PUBLIC_CLARITY_ID` in Vercel production.

## D-10 · TikTok Pixel — **NOT VERIFIED**
`app/layout.tsx:104`, loaded sitewide including admin/buyer/dealer routes per the line-103
comment. Paid-social attribution, not organic. `TIKTOK_ACCESS_TOKEN` etc. at `env.d.ts:276-281`.
**Owner check V-13:** confirm whether sitewide loading on authenticated portal routes is
intended — a third-party pixel on admin and buyer pages is a privacy-review question, not an SEO
one, but it is recorded here because it was observed during this trace.

---

## Consolidated owner-verification checklist

| # | Exact check | Source | Blocks |
| --- | --- | --- | --- |
| V-6 | `GOOGLE_SEARCH_CONSOLE_KEY` present in Vercel production | D-1 | Whether *any* SEO data exists |
| V-7 | `GSC_SITE_URL` matches the GSC property string exactly | D-1 | Silent 403 |
| V-8 | Service-account email added as a GSC property user | D-1 | Silent 403 |
| V-9 | `SELECT count(*), min(week_of), max(week_of) FROM search_intelligence;` | D-1 | Data-history depth |
| V-10 | Last 8 `cron_job_logs` rows for `amips-search-sync` | D-1 | Cron liveness |
| V-11 | `CRON_SECRET` set in Vercel production | D-1 | **All 67 crons** |
| V-12 | `NEXT_PUBLIC_CLARITY_ID` set in production | D-9 | Behavioural data |
| V-13 | Confirm TikTok pixel on authenticated routes is intended | D-10 | Privacy review |
| V-14 | Confirm whether a GA4 property exists at all for autolenis.com | D-2 | Whether D-2 is "never built" or "built and disconnected" |
| V-15 | Confirm the GSC property is verified and has ≥16 months history | D-1 | Backfill feasibility |
