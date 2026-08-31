# 09 — Open Questions

Everything requiring an owner decision or live verification. Nothing here can be resolved from
code alone.

**Visibility limits of this audit (code-only).** Not seen: Vercel environment variables,
live API responses, production database rows, Search Console / GA4 property configuration, live
crawl data, field Core Web Vitals.

---

## Part A — Live verification required

Consolidated from all documents. **Run V-4 first** — it sizes ongoing production damage.

| # | Exact check | Confirms / determines | Source |
| --- | --- | --- | --- |
| **V-4** | `SELECT count(*) FROM amips_pages WHERE lifecycle_status='UNDER_REVIEW';`<br>`SELECT count(*) FROM amips_pages WHERE lifecycle_status='ACTIVE' AND published_at < now() - interval '90 days' AND clicks > 0;` | **How many pages the auto-de-indexing defect has already 404'd, and how many are next.** Highest-urgency check in this audit | `01` C-7 · `04` T-1 |
| V-6 | `GOOGLE_SEARCH_CONSOLE_KEY` present in Vercel **production** | Whether any SEO performance data exists at all | `02` D-1 |
| V-7 | `GSC_SITE_URL` matches the GSC property string exactly (`sc-domain:autolenis.com` ≠ `https://autolenis.com/`) | A mismatch 403s silently and reports success | `02` D-1 |
| V-8 | Service-account `client_email` is a user on the GSC property | Same silent-403 failure | `02` D-1 |
| V-9 | `SELECT count(*), min(week_of), max(week_of) FROM search_intelligence;` | Whether data has ever landed; how much history exists | `02` D-1 |
| V-10 | `SELECT * FROM cron_job_logs WHERE job_name='amips-search-sync' ORDER BY created_at DESC LIMIT 8;` | Whether the weekly cron fires, and its `synced` counts | `02` D-1 |
| **V-11** | `CRON_SECRET` set in Vercel production | **If unset, all 67 crons return 500** — cron auth fails closed by design | `02` D-1 · `07` V-19 |
| V-1 | `SELECT count(*) FROM seo_page_configs;` | Expected **0**. Non-zero ⇒ an out-of-band writer exists and the `08` Part 4 #5 decision changes | `01` C-1 |
| V-2 | `SELECT count(*) FROM seo_health_scores;` | Expected **0** | `01` C-2 |
| V-3 | `SELECT count(*), max(search_volume) FROM seo_keywords;` | Sizes exposure to operator-typed "search volume" | `01` C-5 |
| V-5 | `SELECT sum(leads_generated), sum(revenue_attribution) FROM search_intelligence;` | Expected **0, 0** | `01` C-6 |
| V-12 | `NEXT_PUBLIC_CLARITY_ID` set in production | Whether any behavioural data is collected | `02` D-9 |
| V-13 | Confirm the TikTok pixel loading on authenticated admin/buyer/dealer routes is intended | Privacy review, observed in passing | `02` D-10 |
| V-14 | Does a GA4 property exist for autolenis.com at all? | Distinguishes "never built" from "built and disconnected" | `02` D-2 |
| V-15 | Is the GSC property verified, and does it hold ≥16 months of history? | Backfill feasibility ceiling | `02` D-1 |
| V-16 | `SELECT role, count(*) FROM admins GROUP BY role;` | Practical exposure of AUTHZ-1/2/3 — with no non-`SUPER`/`OPERATIONS` admins, today's risk is nil though the defect stands | `07` |
| V-17 | `RBAC_ENFORCE` is **unset** in production | The permissions layer's own header says leave it unset pending the shadow-denial report | `07` |
| V-18 | `SELECT * FROM audit_logs WHERE action='CONTENT_ARTICLE_BULK_STATUS_CHANGED' ORDER BY created_at DESC LIMIT 20;` | Whether any unbounded bulk publish has run, by whom, at what scale | `07` AUTHZ-1 |
| V-20 | `SELECT count(*) FROM content_articles GROUP BY status;` and `SELECT count(*) FROM amips_pages GROUP BY content_tier;` | The real indexable footprint — `03` gives the queries, not guesses | `03` |
| V-21 | `SELECT count(DISTINCT make), count(*) FROM (SELECT DISTINCT make, model FROM inventory_items WHERE is_active=true) t;` | Whether the sitemap's `take:200` cap is currently truncating make/model coverage | `04` T-11 |
| V-22 | `SELECT count(*) FROM content_attributions;` and `SELECT count(*) FROM content_attributions WHERE converted=true;` | Whether the attribution chain is producing data — the one part of the conversion loop that works | `06` |
| V-23 | GSC → Performance: does the property report **any** query data for non-`/intelligence/` URLs? | Confirms Phase 1 of `08` will yield data immediately | `08` Part 5 |

---

## Part B — Owner decisions

### D-1 · Emergency response to AMIPS de-indexing — **decide first** (REVISED 2026-08-31)
**Superseded in its reasoning by `10-production-reconciliation.md`; the decision still stands,
for different reasons.**

The original framing — that the leads-ratio branch was de-indexing pages weekly — was **wrong**.
Owner-verified state (`clicks = 0` corpus-wide) proves that branch has never fired (`10`, V-3).

What is actually true, and worse: **609 of 794 pages (76.7%) return HTTP 404 and are in no
sitemap today** — call path verified in `10`, STEP 0 — via the staleness branches (`10`, V-2) — Tier C/D/E pages expire 30 days after
generation with no refresh path, and Tier F is stale from birth. A third branch
(`noImpressions`, 180 days) **arms 2026-12-05** reading an empty `search_intelligence`, which
would flag every remaining `ACTIVE` page at once.

**Decision:** pause the `amips-lifecycle` cron now, or accept the scheduled 2026-12-05 event and
continued Tier C/D/E expiry? A pause is a one-line `vercel.json` removal, fully reversible,
changes no data and un-404s nothing. Recovery of the 239 already-demoted `PUBLISHED` pages is a
separate data fix that **must follow the code correction**, or the next Tuesday run re-demotes
them. **This audit made no change.** Full plan in `10` → Remediation.

### D-2 · `seo_page_configs` — repair or retire?
The table has no reachable writer (`01`/C-1). Two coherent options:
- **Retire:** delete the table and the four dead functions; make `/admin/seo/pages` read the real
  route metadata from `lib/seo/metadata.ts` + the 57 public routes. Matches how SEO actually
  works here — schema lives in code.
- **Repair:** wire `upsertPageConfig`/`savePageSchema` to a real admin editing surface, making
  per-page metadata DB-driven and operator-editable without a deploy.

**Recommendation: retire.** `08` Part 4 (#4, #5, #6) assumes retirement. It is a larger change
than it looks — it makes metadata operator-editable, which is a product decision, not a cleanup.
**Contingent on V-1/V-2 returning 0.**

### D-3 · Should the SEO surface own query data, or should AMIPS?
`search_intelligence` lives under AMIPS (`lib/amips/`) but the proposed
`search_query_performance` (`08` §1.4) serves the whole site once the `/intelligence/` filter is
removed. Keep it in `lib/amips/` for continuity, or promote both to `lib/services/seo/`?

**Recommendation: leave the pipeline in `lib/amips/`** — it works and moving it is churn — but
place the new query-level analyses in `lib/services/seo/`, which is currently near-empty and is
the natural home under the project's own service-layer convention.

### D-4 · How far to widen the duplicate-detection corpus?
`05` shows all three uniqueness gates compare pages only within the same location token, so
location-swapped duplicates are structurally invisible. Widening the corpus increases cost
(Jaccard over more bodies) and false positives (legitimate cluster-level similarity is expected).

**Decision:** what similarity threshold for cross-location comparison? The same `0.8`, or a
higher bar recognising that same-cluster pages *should* share structure? **Recommendation:** two
thresholds — `0.8` same-location (existing), `0.9` cross-location — and make the layer REQUIRED
in both engines.

### D-5 · Should make/model pages have an inventory floor?
`05`/R-4: one inventory row creates an indexable page with no gate. A floor (e.g. ≥3 active
listings to be indexable) prevents thin pages but shrinks the footprint and could cause pages to
flap in and out of the index as inventory turns.

**Decision:** what floor, and `noindex` or 404 below it? **Recommendation:** `noindex, follow`
below the floor rather than 404 — it avoids flapping 404s, keeps link equity flowing, and is
reversible. Also needs a hysteresis rule so a page does not toggle weekly.

### D-6 · Sitemap consolidation
`04`/T-4: every AMIPS URL is submitted in two declared sitemaps, defeating the per-tier
indexation tracking the tier split exists for. Tiers E and F have no tier sitemap at all.

**Decision:** keep tier sitemaps (drop `/sitemap-intelligence.xml` from `robots.ts`, add tier E/F)
or keep the single intelligence sitemap (drop the tier split and the `indexation-gate` per-cohort
framing)? **Recommendation:** keep the tier split — the indexation gate is built on it and is the
more valuable capability.

### D-7 · Does the Indexation Gate govern generation, or stay advisory?
`01`/C-8: it computes `scale`/`hold`/`pause` but `amips-generate` uses a hardcoded
`BATCH_LIMIT = 17` and never reads it.
**Decision:** wire it to the batch limit as designed, or relabel it a recommendation? Either is
defensible; **shipping the word "decision" for something that decides nothing is not.**
**Recommendation:** relabel now (trivial), wire it after defect 0.1 — an auto-throttle fed by a
broken lifecycle signal would compound the damage.

### D-8 · GA4: build the loader, or commit to database-side measurement?
`06` shows the DB chain (cookie → `ContentAttribution` → Stripe webhook → deposit → deal) is
genuinely complete and answers *"did this page produce revenue?"* GA4 would add funnel drop-off,
channel reports and audiences — but 21 events are currently written and discarded.
**Decision:** add the loader, or delete the dead `gtag` calls and commit to first-party
measurement? **Recommendation:** add the loader — the events are already instrumented, so the
marginal cost is one component. But it is **not** on the critical path; the revenue question is
already answerable.

### D-9 · Coverage expansion order
`08` Part 3 ranks the gaps. **Decision:** confirm the order — (1) fix 0.1, (2) 20 state hubs,
(3) un-orphan `/intelligence/*`, (4) metro tier, (5) make+model+location. Steps 2–5 are
meaningless while 1 is unfixed, and step 5 is actively harmful without R-4's quality gate.

### D-10 · AI-generation disclosure
`08`/G-4: `/intelligence/*` and `/buying-guide/*` are LLM-generated with no disclosure. Guidance
does not require it; some publishers disclose for trust. AMIPS Gate 1's real-data-token
requirement is a strong existing answer on the value question.
**Decision:** disclose, or rely on the quality gates? Owner call — not a defect either way.

### D-11 · Authorization remediation scope
`07` finds 3 defects, all the same root cause (`getAdminFromRequest` where `getAdminWithRole` /
`requireContentCapability` was intended). AUTHZ-1/2 are one-line fixes.
**Decision:** fix the 3 SEO-surface handlers only, or audit **all** `getAdminFromRequest` call
sites platform-wide for the same pattern? This audit's scope was SEO write paths; the pattern is
unlikely to be confined to them. **Recommendation:** fix the 3 now; schedule a platform-wide
sweep separately.

---

## Part C — Explicitly out of scope, and why

| Item | Why not attempted |
| --- | --- |
| Live broken links, redirect chains/loops | Requires fetching live URLs — no crawler exists (`02` D-8) |
| **Confirmed** orphan pages | `04`/T-7 is a static-link approximation; only a crawl proves reachability |
| Real crawl depth | Requires BFS over rendered HTML |
| Field Core Web Vitals (LCP/CLS/INP) | Requires CrUX or RUM; neither exists (`02` D-4) |
| Actual Google index coverage | Requires GSC Index Coverage; code stores only `indexedStatus` inferred from impressions |
| Rendered-HTML JSON-LD validation | Requires executing pages and validating output |
| Live duplicate-content clustering | Requires crawling rendered bodies; `05` measures templates instead |
| Keyword volumes, difficulty, opportunity scores | **No data source exists** (`02` D-5/D-6). Producing numbers would fabricate them |
| Competitor analysis | No competitive-data source in the repository |
| Migrations for the proposed schema | Frozen migrations `20261014/15/16` pending attorney review; `08` §1.4 is a DDL **proposal** only |

---

## Part D — Where this audit corrected itself

Recorded so a reviewer can trust the rest.

| Initial reading | Correction | Method |
| --- | --- | --- |
| "5 public pages lack metadata, including the Texas state hub" | **4.** `/car-buying-service/texas` uses a *synchronous* `export function generateMetadata()` (`texas/page.tsx:46`), missed by a regex expecting `export const metadata` or `export async function generateMetadata`. It is correctly configured | Read the file rather than trusting the grep (`04` T-3) |
| "Transactional token pages are not disallowed in `robots.txt`" | **Not a finding.** All three carry page-level `robots:{index:false,follow:false}`, which is the *correct* mechanism — a `Disallow` would prevent Google seeing the `noindex` | Read each page's metadata export (`03` F-21) |
| "Tier sitemaps may pass lowercase tiers against uppercase stored values" | **No defect.** Routes pass `"A"`–`"D"`; `content-queue.seed.ts:253,266,281` writes uppercase | Traced both sides (`01`) |
| "`SavingsCallout` may make quantified savings claims contradicting the AMIPS stripper" — initially deferred to the owner | **Verified in-session, and it passes.** The figure block is deliberately withheld pending substantiation and a disclaimer is rendered | Read the component instead of deferring a check code could answer (`05`) |
| "Content publish/unpublish actions lack a role check" | **A-1 is correctly enforced** — it calls `hasContentCapability` at line 64, which the initial grep pattern missed. The real defects are A-2 and A-3 | Read the full handler (`07`) |

| **"The leads-ratio branch is actively de-indexing performing pages weekly"** (`01` C-7, `04` T-1, `08` 0.1) | **WRONG — corrected 2026-08-31.** Owner-verified state has `clicks = 0` for all 794 pages, so `conversion` is `null` and the branch has **never fired**. It is latent, closed by the click gate rather than the age gate | Reconciled the code against owner-verified production state (`10`, V-3). The mechanism was correct; the **tense** was wrong |
| "The 31 UNDER_REVIEW + PUBLISHED pages were demoted by the leads ratio" (implied by `01` C-7) | **WRONG.** They came from the `duplicate` branch at `lifecycle-manager.ts:206`. Proven by elimination: the generator writes `lifecycleStatus` and `qualityGateStatus` atomically from one `gate.status`, so it cannot emit that pair; only `lifecycle-manager.ts:206` writes `UNDER_REVIEW` without touching `qualityGateStatus`; and `clicks = 0` excludes `lowConversion` | Exhaustive writer enumeration (`10`, V-1) |
| The audit did not identify the **actual** active de-indexing paths | **Two new HIGH findings** (`10`, V-2): Tier C/D/E pages expire 30 days after generation with no refresh path; **Tier F is stale from birth** because `isTierCPlus` includes `"F"` while `assembler.ts:236-251` never sets F's as-of dates — while quality Gate 5 passes Tier F using a `{C,D,E}` set. A tier-set contradiction across three files | Traced every branch that can produce a non-`ACTIVE` status (`10`, V-2) |
| The audit understated the scale of present damage | **609 of 794 pages (76.7%) are non-servable now** — larger than the original finding claimed, and already realised rather than prospective | `10`, V-2 |

**Method note.** Two of the first five would have become false findings had the grep result been
reported without opening the file. The sixth through ninth are of a different kind: the code
analysis was correct but **unreconciled against production state**, which made a dormant defect
look active and hid three larger ones. Code-only analysis can establish a mechanism; only state
establishes whether it has fired. Every classification here was made by reading the cited lines,
and every claim about production comes from owner-verified state, not inference.
