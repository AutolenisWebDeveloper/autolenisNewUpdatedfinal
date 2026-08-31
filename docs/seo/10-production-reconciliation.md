# 10 — Production Reconciliation (V-1 … V-5)

Reconciles the code against owner-verified production state. **No production was queried; no
source, cron, data, sitemap, or indexing change was made.** Paths relative to `frontend/`.

Production state below is **owner-VERIFIED** and treated as given, not re-derived.

| Fact | Value |
| --- | --- |
| `amips_pages` total | 794 |
| `leads_generated` | **0 for all 794**, never nonzero |
| `clicks`, `impressions` | **0 for all 794** |
| `published_at` range | 2026-06-08 … 2026-06-28 — **zero rows exceed 90 days** as of 2026-08-31 |
| UNDER_REVIEW + REVIEW_NEEDED | 370 |
| REFRESH_REQUIRED + PUBLISHED | 208 |
| ACTIVE + PUBLISHED | 185 |
| **UNDER_REVIEW + PUBLISHED** | **31** |
| `amips-lifecycle` | 1 logged run, 2026-08-25, `{retired:0, flaggedForReview:0, flaggedForRefresh:0}` |
| `amips-search-sync` | 2 logged runs, 2026-08-24 / 2026-08-31, both `{synced:0, reprioritized:{mode:"launch",reprioritized:0}}` |
| `cron_job_logs` history | begins 2026-08-20 |

---

## Headline

**The audit's core mechanism was right; its tense was wrong.** The leads-ratio branch is real and
confirmed, but it is **currently unreachable** — `clicks = 0` closes it, independent of age. It
did **not** demote the 31.

What did the damage is a **different, unlogged branch of the same function**, and the damage is
larger than the audit reported: **609 of 794 pages (76.7%) are non-servable right now** — every
non-`ACTIVE` page returns HTTP 404 and is absent from every sitemap. Only **185 (23.3%)** are
live. Corrections are applied to `01`, `04`, `08` and recorded in `09` Part D.

---

# V-1 (PRIMARY) — Explaining the 31

## Every writer of `amipsPage.lifecycleStatus` — exhaustive

Repo-wide search over `.ts/.tsx/.sql/.prisma/.js` excluding `node_modules`/`.next`, for
`lifecycleStatus:` assignments and `lifecycle_status`, plus separate sweeps for `$executeRaw` /
`$queryRaw` touching amips (**none**) and for `amipsPage` in `scripts/` and `prisma/`
(**none** — all six `scripts/amips-*.ts` return `0` matches for `amipsPage`).

| # | Site | Writes | Also writes `qualityGateStatus`? | Trigger |
| --- | --- | --- | --- | --- |
| W-1 | `lib/amips/amips-generator.ts:220` (upsert **create**) | `published ? "ACTIVE" : "UNDER_REVIEW"` | **Yes — line 221, same statement** | `amips-generate` cron / queue drain |
| W-2 | `lib/amips/amips-generator.ts:243` (upsert **update**) | `published ? "ACTIVE" : "UNDER_REVIEW"` | **Yes — line 244, same statement** | regeneration of an existing slug |
| W-3 | `lib/amips/lifecycle-manager.ts:188` | `"REFRESH_REQUIRED"` | **No — `lifecycleStatus` only** | `stale \|\| noImpressions` |
| W-4 | `lib/amips/lifecycle-manager.ts:206` | `"UNDER_REVIEW"` | **No — `lifecycleStatus` only** | `duplicate \|\| lowConversion` |
| W-5 | `lib/amips/lifecycle-manager.ts:227` | `"RETIRED"` | **No — `lifecycleStatus` only** | UNDER_REVIEW + 365d + zero traffic |

**Not writers** (checked and excluded): `lib/services/content/content-publishing.service.ts:87`
(writes `contentArticle`, not `amipsPage`); `lib/services/ai/action-intent/store.ts:155`
(different model); all `migrations/**` and `prisma/**` occurrences (DDL, defaults and indexes
only — `DEFAULT 'ACTIVE'`); `executive-intelligence.ts` (reads only). **There is no admin route,
backfill script, seed, or manual SQL path that writes it.**

## The deduction

`amips-generator.ts` writes `lifecycleStatus` **and** `qualityGateStatus` in the **same object
literal**, both derived from one `gate.status` (line 198: `const published = gate.status ===
"PUBLISHED"`). `FAILED` returns early at lines 181-193 and never persists a page. So the
generator can emit exactly two pairs:

| `gate.status` | `lifecycleStatus` | `qualityGateStatus` |
| --- | --- | --- |
| `PUBLISHED` | `ACTIVE` | `PUBLISHED` |
| `REVIEW_NEEDED` | `UNDER_REVIEW` | `REVIEW_NEEDED` |

> **`(UNDER_REVIEW, PUBLISHED)` is unreachable from the generator — on both the create and the
> update path.** It can only arise if something later changed `lifecycleStatus` while leaving
> `qualityGateStatus` untouched. W-3, W-4 and W-5 are the only writes that do that, and **W-4 is
> the only one that writes `UNDER_REVIEW`.**

**∴ The 31 were written by `lib/amips/lifecycle-manager.ts:206`, from a prior `(ACTIVE,
PUBLISHED)` state.**

W-4 fires on `if (duplicate || lowConversion)` (line 204). Production has `clicks = 0` for all
794, so line 196 `const conversion = p.clicks > 0 ? p.leadsGenerated / p.clicks : null` yields
`null`, and line 200 `conversion !== null` is **false** ⇒ `lowConversion = false`.

**∴ `duplicate = true`. The 31 are duplicate-cluster demotions.**

## The duplicate branch — preconditions and fit

`lifecycle-manager.ts:146-168`:

| Precondition | Line | Fit with the 31 |
| --- | --- | --- |
| `p.lifecycleStatus === "ACTIVE"` at scan time | 151 | ✓ they were `ACTIVE + PUBLISHED` |
| `make`, `model` **and** `metro` all non-null | 152 | ✓ implies tier ∈ {C,D,E} — `metro` is set only on the metro-tier return (`assembler.ts:21,255,326`) |
| cluster key `make\|model\|metro` lowercased, ≥2 members | 153-160 | ✓ |
| sort `impressions` DESC, then `publishedAt` ASC; all but `sorted[0]` flagged | 161-167 | ✓ **with `impressions = 0` for every page the primary sort key is inert, so canonical selection collapses to earliest `publishedAt`** |
| no age, click, impression or lead precondition | — | ✓ fires immediately on any run |

The publish dates fit precisely: the 31 carry `published_at` 2026-06-25/26 and
`last_refreshed_at` 2026-06-26 — i.e. a cluster of pages generated together, of which the
earliest-published member in each `make|model|metro` group survived as `ACTIVE` and the rest were
demoted.

## Why the one logged run flagged zero — consistent, not contradictory

The 2026-08-25 run reported `flaggedForReview: 0`. That is **expected**, not evidence against
the above: by then the 31 were already `UNDER_REVIEW`, so line 151
(`if (p.lifecycleStatus !== "ACTIVE") continue`) excludes them from cluster building, and the
`ACTIVE` branch at line 177 never evaluates them. `flaggedForRefresh: 0` is likewise consistent —
the 208 were already `REFRESH_REQUIRED`, and the surviving 185 are non-metro tiers whose only
applicable check is vehicle ≤180d (≈78 days old at that date). **The whole logged run is
consistent with the reconstruction.**

## Can the responsible run be dated from code?

**No — and the reason is itself a finding.** `cron_job_logs` history begins 2026-08-20; the
demotion happened before that. **`runLifecycleReview` writes no audit record** — no `AuditLog`,
no workflow event, no per-page transition history. `amipsPage` has no `lifecycleChangedAt` or
prior-status column (`prisma/schema.prisma:4757-4790`). A page's demotion is therefore
unattributable after the fact.

Code does bound the window. The 31 must be tier C/D/E (they have a `metro`), and for those tiers
`hasStaleData` (lines 62-67) checks `marketDataAsOf` against a **30-day** ceiling. Staleness is
evaluated **first** and `continue`s (lines 183-192), so a run reaching the duplicate branch must
have occurred while their market data was still within 30 days.

> **Responsible run: an `amips-lifecycle` execution between ~2026-06-26 and ~2026-07-26.** The
> cron is `0 4 * * 2` (Tuesdays), giving candidate dates **2026-06-30, 07-07, 07-14, 07-21**.

**Exact evidence that would settle it** (owner-side, none require production writes):
1. Vercel function logs for `/api/cron/amips-lifecycle` in 2026-06-26 … 2026-07-26 — the handler
   logs `[amips-p3-lifecycle] done — refresh N, review M, retired K` (line 215).
2. Any `cron_job_logs` retained before 2026-08-20 (backup/export), same window.
3. Supabase point-in-time recovery or WAL/audit retention on `amips_pages`, if enabled.

**Verdict — V-1: the responsible code path is determined; the responsible run is not.** The path
is `lib/amips/lifecycle-manager.ts:206` via the `duplicate` branch. `lowConversion` is excluded
by `clicks = 0`, and the generator is excluded by the atomic
`lifecycleStatus`/`qualityGateStatus` write.

---

# V-2 — Sibling de-indexing paths

## The serving and sitemap gates

> **STEP 0 — does `REFRESH_REQUIRED` serve? VERIFIED: no, it 404s.** The 76.7% figure
> below rests on this and was previously asserted without a complete call path. Traced
> against the pre-remediation code:
>
> 1. `GET /intelligence/<slug>` → `app/(public)/intelligence/[slug]/page.tsx:88`
>    `IntelligenceArticlePage`
> 2. → `:90` `loadPage(slug)`
> 3. → `:35-44` `prisma.amipsPage.findFirst({ where: { slug, lifecycleStatus: "ACTIVE" } })`
> 4. `REFRESH_REQUIRED !== "ACTIVE"` ⇒ returns `null`
> 5. → `:91` `if (!page) notFound()` ⇒ **HTTP 404**
> 6. `generateMetadata` (`:72-74`) calls the same `loadPage` and returns
>    `robots: { index: false, follow: false }` (`:78`) on miss
>
> `app/` contains exactly **two** consumers of `prisma.amipsPage`
> (`sitemap-intelligence.xml/route.ts:32`, `intelligence/[slug]/page.tsx:37`) and both were
> `ACTIVE`-only, so no other route served these pages.
>
> **∴ 609/794 (76.7%) is correct as documented against pre-remediation code.** The
> alternative reading — that `REFRESH_REQUIRED` still serves, giving 401/794 — is refuted
> by step 4.
>
> **Post-remediation this becomes 401/794.** FIX 3 in this batch makes `REFRESH_REQUIRED`
> servable (`lib/amips/tiers.ts` → `SERVABLE_LIFECYCLE_STATUSES`), returning the 208 Tier C
> pages to the index with no data change. The figure below describes the state this batch
> corrects, not the state after it ships.

| Surface | Gate (pre-remediation) | File:line |
| --- | --- | --- |
| `/intelligence/[slug]` | `where: { slug, lifecycleStatus: "ACTIVE" }` → `notFound()` | `app/(public)/intelligence/[slug]/page.tsx:38, 91` |
| `sitemap-amips-{a..d}.xml` | `contentTier: tier, lifecycleStatus: "ACTIVE"` | `lib/amips/sitemap.ts:51` |
| `sitemap-intelligence.xml` | `lifecycleStatus: "ACTIVE"` | `app/sitemap-intelligence.xml/route.ts:33` |

**`lifecycleStatus === "ACTIVE"` is the sole serving gate.** `dataTokenCount` and
`qualityGateStatus` are **write-only** — a repo-wide search shows their only occurrences are the
four generator writes (`amips-generator.ts:218,221,241,244`). **There is no token-count
threshold and no quality-gate re-evaluation at serve time.** So *any* non-`ACTIVE` status ⇒ 404 +
delisted, with no gradation.

**Present-tense impact (VERIFIED state, pre-remediation):** 370 + 208 + 31 = **609 of 794 pages
(76.7%) return HTTP 404 and appear in no sitemap.** 185 are servable.
**After FIX 3: 401 of 794 (50.5%)** — the 208 `REFRESH_REQUIRED` Tier C pages become servable
again. The remaining 401 are `UNDER_REVIEW` (370 awaiting human review + 31 duplicate
demotions), which correctly stay withheld.

## Every condition producing a non-ACTIVE status

| # | Branch | Line | Field read | Populated in production? | Status |
| --- | --- | --- | --- | --- | --- |
| S-1 | `stale` — vehicle > 180d (all tiers) | 60 | `vehicleDataAsOf` | **Yes** — set on all three assembler returns (250, 263, 335) | dormant (≈84d max) |
| S-2 | `stale` — Tier C+ `dealerDataAsOf` null **or** > 90d | 64 | `dealerDataAsOf` | C/D/E: yes (`assembler.ts:336`). **Tier F: always NULL** | **ACTIVE — see V2-B** |
| S-3 | `stale` — Tier C+ `marketDataAsOf` null **or** > 30d | 66 | `marketDataAsOf` | C/D/E: yes (`:337`). **Tier F: always NULL** | **ACTIVE — see V2-A** |
| S-4 | `noImpressions` — age ≥180d **and** `imp180 === 0` | 181-183 | `imp180` ← `searchIntelligence` | **Table is empty (V-4)** → always 0 | **latent, arms 2026-12-05** |
| S-5 | `duplicate` — cluster peer | 197 | `make/model/metro`, `impressions` | Yes / impressions always 0 | **ACTIVE — produced the 31** |
| S-6 | `lowConversion` — age ≥90d **and** ratio < 0.001 | 198-201 | `clicks`, `leadsGenerated` | **Both always 0** | **unreachable — V-3** |
| S-7 | `RETIRED` — UNDER_REVIEW, age ≥365d, zero traffic | 216-229 | `traffic365`, `p.impressions`, `p.clicks` | **All always 0** | **latent, arms 2027-06-08** |

### V2-A · Tier C/D/E pages have a 30-day servable lifespan by construction — HIGH
`MARKET_MAX_AGE_DAYS = 30` (`lifecycle-manager.ts:32`) is checked against `marketDataAsOf`, which
is written **only** by the generator (`amips-generator.ts:229, 252` from `assembler.ts:337`).
**Nothing refreshes it.** There is no market-data refresh path that updates an existing page's
`marketDataAsOf` without a full regeneration. Therefore every Tier C/D/E page becomes `stale` on
the first lifecycle run ≥30 days after generation and transitions to `REFRESH_REQUIRED` → 404.

This is the most probable explanation for the **208**: pages published 2026-06-08…28 cross the
30-day mark 2026-07-08…28, and the Tuesday cron would have caught them in late July. No age or
traffic precondition is involved.

### V2-B · Tier F is permanently stale from birth — HIGH
A tier-set asymmetry across three files:

| Set | Members | File:line |
| --- | --- | --- |
| assembler `METRO_TIERS` | C, D, E | `lib/amips/assembler.ts:21` |
| quality-gate `METRO_TIERS` | C, D, E | `lib/amips/quality-gate.ts:18` |
| lifecycle `isTierCPlus` | C, D, E, **F** | `lib/amips/lifecycle-manager.ts:43-45` |

The **Tier F return** (`assembler.ts:236-251`) sets `market: { metro, state, dealerCount }` and
`vehicleDataAsOf` — but **omits `dealerDataAsOf` and `marketDataAsOf` entirely** (contrast the
metro-tier return at `:335-337`, which sets all three). The generator then persists
`dealerDataAsOf: data.dealerDataAsOf ?? null` and `marketDataAsOf: data.marketDataAsOf ?? null`
(`:228-229, :251-252`) ⇒ **both NULL for every Tier F page**.

`hasStaleData` includes F via `isTierCPlus`, and line 64 is `if (dAge === null || dAge > 90)
return true`. **`ageDays(null)` returns `null` (line 39) ⇒ stale is `true` on the first
lifecycle run, immediately after publication, permanently.** Regeneration reproduces the same
nulls, so a Tier F page can never return to `ACTIVE`.

Compounding it: quality **Gate 5** passes Tier F because it uses the `{C,D,E}` set
(`quality-gate.ts:18,80,131`) and only checks vehicle freshness. **The gate certifies the page as
fresh; the lifecycle manager treats it as permanently stale.** A direct contradiction between two
tier sets that must agree.

### V2-C · Three branches key on structurally-always-zero fields — HIGH
S-4, S-6 and S-7 read `imp180`, `traffic365`, `p.clicks`, `p.impressions` and `leadsGenerated`.
`imp180`/`traffic365` come from `searchIntelligence` (`loadTraffic`, lines 79-114), which is
empty (V-4); `p.clicks`/`p.impressions` are written only by
`search-intelligence.pipeline.ts:230-233`, which has synced nothing; `leadsGenerated` has no
writer at all. **Every one of these branches therefore reads "zero traffic" for every page,
regardless of true traffic**, and each treats zero as *evidence of failure* rather than *absence
of measurement*.

The consequence is a scheduled mass event, not a gradual one:

| Date | Trigger | Effect |
| --- | --- | --- |
| **2026-09-06** | earliest cohort reaches 90d | S-6 age gate opens — **still blocked by `clicks = 0`** |
| **2026-12-05** | earliest cohort reaches 180d | **S-4 opens: every remaining `ACTIVE` page with `imp180 === 0` → `REFRESH_REQUIRED` → 404.** Because the table is empty, that is *all* of them |
| **2027-06-08** | earliest cohort reaches 365d | S-7 opens: `UNDER_REVIEW` pages retire en masse on the same always-zero reading |

> **Answering V-2's stated goal directly: fixing only the leads ratio (S-6) would close the one
> branch that is not currently firing and leave S-2, S-3, S-4, S-5 and S-7 open.** S-6 is the
> *least* active of the six. Any remediation must treat "no measurement" as distinct from
> "measured zero" across all of them.

---

# V-3 — The leads-ratio branch

## Full trace

**Schema:** `AmipsPage.leadsGenerated Int @default(0)` (`prisma/schema.prisma:4784`).

**Writers — none.** All five `amipsPage` write sites enumerated in V-1; none sets
`leadsGenerated`. The only `leadsGenerated:` assignments in the repo
(`search-intelligence.pipeline.ts:212,223`) write **`searchIntelligence.leadsGenerated`**, and
the value written is `page.leadsGenerated` (line 198) — i.e. it copies the always-zero field into
a second table.

**Readers:** `lifecycle-manager.ts:196`; `executive-intelligence.ts:375,380,385,389-390,544,555`;
`content-queue.seed.ts:428`; `search-intelligence.pipeline.ts:198`.

## The exact lifecycle sequence

| Step | Detail | Line |
| --- | --- | --- |
| 1. Load | `where: { lifecycleStatus: { in: ["ACTIVE","UNDER_REVIEW"] } }`, selects `clicks`, `leadsGenerated`, `publishedAt` | 124-142 |
| 2. Traffic | `loadTraffic()` aggregates `searchIntelligence` into `imp180` / `traffic365` | 145, 79-114 |
| 3. Branch | `if (p.lifecycleStatus === "ACTIVE")` | 177 |
| 4. **Staleness first** | `if (stale \|\| noImpressions) { … continue; }` — **preempts the ratio branch entirely** | 179-192 |
| 5. Ratio | `const conversion = p.clicks > 0 ? p.leadsGenerated / p.clicks : null` | 196 |
| 6. Threshold | `pubAge >= 90 && conversion !== null && conversion < 0.001` | 198-201 |
| 7. Transition | `data: { lifecycleStatus: "UNDER_REVIEW" }` | 204-207 |
| 8. HTTP | `where {slug, lifecycleStatus:"ACTIVE"}` → `notFound()` = **404** | route `:38, :91` |
| 9. Sitemaps | excluded from tier and intelligence sitemaps | `sitemap.ts:51`; `sitemap-intelligence.xml/route.ts:33` |
| 10. Schedule | `vercel.json` `0 4 * * 2` → `/api/cron/amips-lifecycle` → `authorizeCronRequest` → `withCronRun("amips-lifecycle", runLifecycleReview)` | `route.ts:20` |

## Verdict — **CONFIRMED UNREACHABLE**

With `clicks = 0` across all 794 rows, line 196 evaluates the false arm and yields `null`; line
200 requires `conversion !== null`; therefore `lowConversion` is `false` for every page.

**The branch is closed by the click gate, not the age gate.** It would remain unreachable even if
every page were past 90 days. Two independent conditions must both open:

| Gate | Opens | Currently |
| --- | --- | --- |
| Age ≥ 90d | **2026-09-06** (earliest cohort, 2026-06-08 + 90d); full corpus by **2026-09-26** | 6 days away |
| `clicks > 0` | only when `search-intelligence.pipeline.ts:230-233` writes a nonzero click count | closed — `synced: 0` |

> **The defect arms itself the moment the GSC sync starts returning rows.** Repairing V-4 without
> first repairing V-3 would activate S-6 on a corpus that is by then all past 90 days — turning a
> dormant defect into an active one on the first successful sync after 2026-09-26.

**Correction to the prior audit.** `01`/C-7 and `04`/T-1 stated this branch was *currently*
de-indexing pages weekly. **That was wrong.** The mechanism is real and the code is unchanged,
but the branch has never fired and cannot fire in the present state. Corrections applied; see
`09` Part D.

---

# V-4 — Why `synced: 0`

## What the logged output already proves

The cron returns `{success:false, error:"No GSC_SITE_URL / NEXT_PUBLIC_APP_URL configured"}`
**outside** `withCronRun` (`route.ts:31-36`) — that path writes **no** `cron_job_logs` row. The
owner's logs show two rows whose payload is `{"synced":0,…,"reprioritized":{…}}`, which is the
shape returned from **inside** `withCronRun` at `route.ts:46-50`.

> **∴ `GSC_SITE_URL` or `NEXT_PUBLIC_APP_URL` is set, and execution reached
> `syncSearchIntelligence` and then `reprioritizeContentQueue`.** The missing-site-URL
> explanation is ruled out.

`reprioritized.mode === "launch"` means `hasMaturedSearchIntelligence()` returned `false`
(`content-queue.seed.ts:399-403`), i.e. `searchIntelligence` is **empty or its earliest row is
<60 days old** (`:376-386`). Combined with two consecutive `synced: 0` runs, the table is empty.

## The six paths that all yield `synced: 0`

| # | Path | Line | Log emitted |
| --- | --- | --- | --- |
| P-1 | `GOOGLE_SEARCH_CONSOLE_KEY` unset | 49-51 | `warn` "…not set; skipping sync" |
| P-2 | key malformed / missing fields | 55-58, 60-63 | `warn` |
| P-3 | token exchange non-OK or throw | 90-93, 96-99 | `warn` with status |
| P-4 | Search Analytics query non-OK (403/401/429) | 158-161 | `warn` with status |
| P-5 | query fetch throws / times out | 164-167 | `warn` |
| P-6 | rows returned but **no `/intelligence/*` matches** | 178-181 | `info` "no /intelligence/* rows returned" |
| P-7 | matches found but no `amipsPage` row | 192 | **silent `continue`** |

**All seven produce an identical cron payload.** Code alone cannot distinguish them — this is the
silent-degradation defect recorded at `02`/§1.7.

## Row-matching audit (the hypothesis-(a) check)

| Risk | Code | Verdict |
| --- | --- | --- |
| Protocol / host mismatch | filter is `url.includes("/intelligence/")` (`:172`), a substring test — protocol, host and port are irrelevant | **not a defect** |
| Trailing slash | `slugFromUrl` splits on `[?#/]` (`:112`) — `…/intelligence/foo/` → `"foo"` | **handled** |
| Query string / fragment | same split handles `?` and `#` | **handled** |
| Percent-encoding | `decodeURIComponent` (`:113`) | **handled** |
| Slug case | slugs are lowercased at generation (`amips-generator.ts:34-38`) and the route is `/intelligence/[slug]`, so crawled URLs are lowercase | **not a defect** |
| Tier case | `contentTier` is `select`ed and copied (`:185,206,217`), never used as a join key | **irrelevant to the join** |
| Join | `where: { slug: { in: candidates.map(c => c.slug) } }` (`:183-184`), exact match | **sound** |

> **No trailing-slash, protocol, host, or tier-case defect exists. The matching logic is correct.**

## Which explanation the code supports

**Explanation (b) — GSC genuinely returns no rows for these URLs** — is strongly supported, on
evidence that is itself code-plus-verified-state and does not require production access:

1. **609 of 794 pages (76.7%) currently return HTTP 404** (V-2). Google cannot report impressions
   for pages that 404, and would drop previously-indexed ones.
2. **The 185 servable pages are orphaned** — no public inbound link anywhere in
   `app/(public)/**` or `components/**` (`04`/T-7), and the only `/intelligence` link in the repo
   is an admin button pointing at a non-existent index route.
3. `impressions = 0` **and** `clicks = 0` for all 794 — consistent with never having been indexed
   rather than with a write-path defect, which would more likely produce partial or stale data.
4. `mode: "launch"` independently confirms `searchIntelligence` is empty.

**But (a) cannot be excluded from code**, because P-1/P-2 (credential absent or malformed) are
observationally identical to (b) in the cron payload. **This is the honest limit of code-only
analysis.**

## Owner-side evidence that would settle it

| # | Check | Distinguishes |
| --- | --- | --- |
| V4-a | GSC → Performance → filter *Page contains* `/intelligence/`, last 3 months | Zero rows ⇒ **(b)** confirmed. Non-zero ⇒ **(a)** |
| V4-b | Vercel logs for `/api/cron/amips-search-sync` on 2026-08-24 and 2026-08-31; look for `[amips-p3-search]` warn lines | Identifies P-1…P-5 by message; **absence of any warn line plus the `info` "no /intelligence/* rows returned" ⇒ P-6 ⇒ (b)** |
| V4-c | Confirm `GOOGLE_SEARCH_CONSOLE_KEY` present in Vercel production | Rules out P-1 directly |
| V4-d | GSC → Pages → inspect any `/intelligence/<slug>` URL | Shows crawl/index status and whether Google sees 404s |

**V4-b is decisive and cheapest** — the log line alone separates every path.

---

# V-5 — Confirming three audit claims

### 1. GSC limited to `/intelligence/*` by the filter at `pipeline.ts:172` — **VERIFIED**
`const INTELLIGENCE_PATH = "/intelligence/"` (`:30`); filter
`if (!url || !url.includes(INTELLIGENCE_PATH)) return [];` (`:172`) inside the `rows.flatMap`
(`:170-176`).
**Complete call path:** `vercel.json` cron `0 5 * * 1` → `app/api/cron/amips-search-sync/route.ts:21`
`GET` → `:22` `authorizeCronRequest` → `:38` `withCronRun("amips-search-sync", …)` → `:39`
`syncSearchIntelligence(siteUrl, weekOf)` → `pipeline.ts:141-157` query (no `dimensionFilterGroups`
— **the API returns all pages; the discard is client-side**) → `:170-176` filter.

### 2. Page-level dimensions only; query-level analysis impossible — **VERIFIED**
Request body: `dimensions: ["page"]` (`:152`) — the sole `dimensions` occurrence in the file.
`GscRow` (`:37-43`) types only `keys/clicks/impressions/ctr/position`.
`SearchIntelligence` (`prisma/schema.prisma:4673-4695`) has `url` and **no `query` or `keyword`
column**; the unique key is `@@unique([url, weekOf])` (`:4689`), which makes one row per page per
week and **cannot represent per-query rows without a schema change**.
Striking distance, low-CTR-vs-expected, decline-by-query and cannibalization all require per-query
grain. **Impossible against current data — confirmed.**

### 3. GA4 events emitted, no loader or configuration path — **VERIFIED**
**Emitters (3):** `lib/analytics/events.ts:20`, `lib/analytics/funnel-events.ts:58`,
`components/tools/DealerFeeCalculator.tsx:47` (`w.gtag?.(...)`, declared `:44`).
**Case-sensitive searches across `app/`, `components/`, `lib/`, `public/`, `package.json`,
`next.config.mjs`, `env.d.ts`:**

| Searched | Result |
| --- | --- |
| `gtag/js`, `googletagmanager`, `@next/third-parties`, `GoogleAnalytics` | **NONE** |
| `'G-XXXXXXXX'` measurement-id literal | **NONE** |
| `NEXT_PUBLIC_GA`, `GA_MEASUREMENT`, `GA_TRACKING`, `ANALYTICS_ID` | **NONE** |
| `next/script` importers | **exactly 2**: `components/seo/Clarity.tsx:3`, `components/analytics/TikTokPixel.tsx:3` |

`window.gtag` is therefore permanently `undefined`; every call optional-chains to a no-op. **No
env var could enable it — there is no loader to configure.** Confirmed: a code gap, not a
configuration gap.

---

# Remediation plan (smallest viable)

**Not implemented — for owner approval.**

## Should `amips-lifecycle` be paused?

**Yes — but not for the reason the original audit gave.** The leads-ratio branch is dormant
(V-3). The warranted reasons are:

| Reason | Urgency |
| --- | --- |
| **S-4 arms 2026-12-05** and reads an empty table — on that Tuesday every remaining `ACTIVE` page is flagged `REFRESH_REQUIRED` → 404 | highest — a scheduled mass 404 event |
| **S-2/S-3 (V2-A, V2-B)** continue firing: Tier C/D/E expire 30 days after generation with no refresh path; Tier F is stale from birth | active now |
| **S-5** continues demoting duplicates using an inert `impressions` sort key | active now |
| **S-6 arms** once V-4 is fixed and the corpus is past 90 days | conditional |

Pausing is a one-line `vercel.json` removal, fully reversible, and stops all four. **It changes
no data and un-404s nothing** — recovery is separate. Given only 185 pages remain `ACTIVE` and
every one is on a countdown driven by fields that cannot be populated, pausing until the
correction ships is the low-risk choice.

## Minimal code correction — four changes, one principle

**Principle: distinguish *"not measured"* from *"measured zero."*** Every defect above is one
error expressed five ways.

| # | Change | File | Closes |
| --- | --- | --- | --- |
| C-1 | Gate `lowConversion` on the conversion metric being *populated*, not merely non-null — require evidence that leads are being recorded before treating a ratio as meaningful | `lifecycle-manager.ts:196-201` | S-6 |
| C-2 | Gate `noImpressions` and the `RETIRED` traffic test on `searchIntelligence` having data for the window at all; absent data ⇒ skip, never "zero" | `lifecycle-manager.ts:181-183, 216-229`, `loadTraffic:79-114` | S-4, S-7 |
| C-3 | Align the tier sets: either drop `"F"` from `isTierCPlus` **or** populate `dealerDataAsOf`/`marketDataAsOf` on the Tier F return. The three sets must agree | `lifecycle-manager.ts:43-45` **or** `assembler.ts:236-251` | S-2, V2-B |
| C-4 | Give `marketDataAsOf` a refresh path, or make the 30-day ceiling a *refresh signal* that does not un-serve the page (`REFRESH_REQUIRED` should not imply 404) | `lifecycle-manager.ts:32,188` + serving gate | S-3, V2-A |

**C-4 is the highest-leverage structural change:** `REFRESH_REQUIRED` means *"this page's data is
aging"* — it should not remove the page from the internet. Separating "needs refresh" from "not
servable" would have prevented the 208 outright. Consider serving `REFRESH_REQUIRED` pages
normally while surfacing them in the admin queue.

## Evaluating the 31 for restoration

They are duplicate demotions where **canonical selection was effectively arbitrary** — with
`impressions = 0` the primary sort key was inert and selection fell through to earliest
`publishedAt` (`lifecycle-manager.ts:161-167`). There is no traffic evidence to justify which
member of each cluster deserves to be canonical.

**Recommended, in order:**
1. **Do not bulk-restore.** Group the 31 by `make|model|metro` and inspect each cluster.
2. **Restore where no live duplicate exists** — if every other member of a cluster is now
   non-`ACTIVE`, the demotion serves no purpose and the page can return to `ACTIVE`.
3. **Where a live `ACTIVE` peer exists**, leave the demotion and revisit once real GSC data can
   inform canonical choice — or resolve properly with a canonical tag rather than a 404.
4. **Note the same question applies to the 208**, which are a larger population and were removed
   by a mechanism (V2-A) that will simply re-fire unless C-4 ships first. **Restoring them before
   C-4 would be undone at the next Tuesday run.**

## Remediation applied on this branch

Implemented under owner authorization. **No deploy, no production data mutation, no cron config
change, no migration.** `pipeline.ts`'s `/intelligence/` filter remains untouched.

| Fix | Change | Files |
| --- | --- | --- |
| **1a** | `buildQueueDrafts()` now collapses drafts sharing a `keywordTarget`, keeping the highest-priority one. Root cause: `VEHICLE_SEEDS` carries one row per **trim** (Ford F-150 XL + XLT) and neither keyword template includes the trim, so both seeds produced one keyword; `seedContentQueue()` filtered against keywords already in the DB but never against its own batch, and `content_queue` has no unique constraint. **Measured: 1000 → 955 drafts, 45 duplicate rows eliminated.** | `lib/amips/seed/content-queue.seed.ts` |
| **1b** | New exported `findEntityConflict()`, checked before the quality gates: a second page for an existing `(make, model, metro)` now fails the queue item with `duplicate_entity` instead of publishing. Reuses the Gate-2 query (widened `select`), so no extra round trip. Scoped to pages carrying a metro, matching the lifecycle cluster key, so Tier A/B angles are unaffected. | `lib/amips/amips-generator.ts` |
| **2** | New `lib/amips/tiers.ts` is the single authority. `MARKET_DATA_TIERS` = {C,D,E,**F**} now drives **both** Gate 5 and the lifecycle staleness check; `METRO_ASSEMBLY_TIERS` = {C,D,E} is documented as assembler routing only. The Tier F assembler return now populates `dealerDataAsOf` / `marketDataAsOf`. | `lib/amips/tiers.ts`, `assembler.ts`, `quality-gate.ts`, `lifecycle-manager.ts` |
| **3** | **Chosen: stop treating absent refresh as a de-indexing condition.** `REFRESH_REQUIRED` is now servable and sitemap-listed via one shared `SERVABLE_LIFECYCLE_STATUSES`; de-indexing destroys ranking equity for what is an editorial signal. Serving and sitemap inclusion derive from **one** constant, so a page can never be live-but-unlisted or listed-but-404. **⚠ The rationale first given here cited 31-day-old data; production is 66–85 days and was unbounded. Corrected under BLOCKER 2 below, which adds `STALE_WITHHOLD_DAYS` as the outer bound.** | `tiers.ts`, `intelligence/[slug]/page.tsx`, `lib/amips/sitemap.ts`, `sitemap-intelligence.xml/route.ts` |
| **4** | New exported `shouldFlagLowConversion()`. A corpus-level `leadsTrackingActive` probe gates the branch: while no page reports a lead, the ratio is treated as **unknown**, not zero. The branch resumes working automatically once a writer exists. | `lib/amips/lifecycle-manager.ts` |
| **5** | `runLifecycleReview()` now returns `transitions[]` (`slug`, `from`, `to`, `reason`), capped at `MAX_LOGGED_TRANSITIONS` with a `transitionsTruncated` flag, plus `leadsTrackingActive`. `withCronRun` persists it to `cron_job_logs.result` (already `Json`) — **no new table**. The five reasons are distinct, so `duplicate_cluster` vs `low_conversion_90d` — the exact distinction that was unanswerable this batch — is now recorded. | `lib/amips/lifecycle-manager.ts` |

**Effect on the corpus once deployed:** non-servable drops from **609/794 to 401/794**. The 208
Tier C `REFRESH_REQUIRED` pages return to the index with no data change. The 401 that remain are
`UNDER_REVIEW` (370 awaiting human review on their own merits + 31 duplicate demotions) and stay
correctly withheld pending the repair script.

### Owner verification round 2 — two blocking findings, both correct

Both were found in production data after the first remediation and both are fixed on this branch.

#### BLOCKER 1 — the repair script would have re-created all 31 duplicates

Owner-verified across the 31 `UNDER_REVIEW + PUBLISHED` clusters: **0** have an `ACTIVE` sibling,
**31** have a `REFRESH_REQUIRED` sibling, **0** are fully dark.

The script asked `lifecycleStatus === LIFECYCLE_ACTIVE`. Pre-FIX-3 that was equivalent to "is
anything live here?" — post-FIX-3 it is not, because `REFRESH_REQUIRED` now serves. All 31
clusters therefore already have a **live canonical**, and promoting a demoted sibling would put
two live pages on one `(make, model, metro)` — re-creating exactly the duplication the lifecycle
manager correctly resolved.

**This is the same ACTIVE-literal-vs-servability assumption the first batch's second review caught
in the clustering path. The script carried a second copy of it, and I did not check for one.**
The lesson is that the assumption was a *class* of defect, not a single site; the fix is now a
shared predicate (`isServableLifecycleStatus`) with no remaining literal comparisons.

| Change | Detail |
| --- | --- |
| New `lib/amips/lifecycle-repair.ts` | `planClusterRepair()` + `rankCanonical()`, pure and unit-tested. Extracted from the script so the rule is testable at all — it previously lived inside a `main()` that could not be imported |
| Rule corrected | `siblings.find(s => isServableLifecycleStatus(s.lifecycleStatus))` |
| Script header + summary | State explicitly that **promote-nothing is the expected and correct output**, and print that conclusion at runtime when `promoted === 0` |

**Output against the verified state: 0 promotions, 31 clusters skipped.** There is nothing to
repair — FIX 3 already returned the 208 `REFRESH_REQUIRED` pages to the index, and *those pages
are the canonicals*. A repair that correctly does nothing is the right outcome.

#### BLOCKER 2 — FIX 3 had no upper staleness bound

Owner-verified Tier C staleness: **market 66d, dealer 66d, vehicle 85d**. The original
justification assumed 31 days, which was wrong — it took the *threshold* (30) for the *actual*
age. With no refresh path and staleness no longer withholding, the bound was infinite on vehicle
pricing and dealer pages.

**(a) Disclosure — partly pre-existing, two real gaps closed.**

| Surface | Before | Status |
| --- | --- | --- |
| `intelligence/[slug]/page.tsx:181-185` freshness footer | "Last Updated … · Data as of …", plain text | **existed, visible** |
| `components/amips/MarketScoreTable.tsx:69` | "Computed from market data, never estimated. Data as of …", plain text | **existed, visible** (market tiers only) |
| Machine-readable | neither used `<time dateTime>` | **added to both** |
| Correct date | `marketDataAsOf ?? vehicleDataAsOf` took the first non-null **by priority, not the oldest** | **fixed** — now `oldestApplicableDataAsOf()` |

That second gap was itself an accuracy defect: against production the page advertised **66 days**
for a page whose oldest load-bearing figure was **85** — understating staleness by 19 days on a
pricing page, in the very disclosure meant to make staleness legible.

**(b) Outer bound: `STALE_WITHHOLD_DAYS = 180`, keyed on the oldest applicable timestamp.**

It is not a new number. It is `FRESHNESS_DAYS.vehicle` — the age at which **Quality Gate 5 already
refuses to generate a page**. The invariant is the coherent one:

> **serve only what we would still be willing to publish.**

Continuing to serve pricing we would refuse to publish today is indefensible; that argument needs
no independent threshold, which is why no round number was invented.

| Property | Value |
| --- | --- |
| Multiple of the market gate (30d) | **6×** |
| Multiple of the dealer gate (90d) | **2×** |
| Current worst case | 85 days |
| Headroom today | **~95 days — nothing withholds now** |

That headroom is what makes it a backstop rather than a re-run of the 30-day defect, where pages
went dark almost immediately. Why not 365: a year guarantees crossing a model-year rollover, so
the page would quote prior-model-year MSRP as current. Why not tighter: the system is willing to
*publish* at 180, so withholding sooner would dark freshly-publishable pages.

Enforced at the route (`loadPage`) **and both sitemaps**, using one predicate — the same
discipline as `SERVABLE_LIFECYCLE_STATUSES`, so a withheld page is never advertised.

**THE BOUND HAS A DEADLINE — this is the operational consequence to act on.** Vehicle data is 85
days old, so it crosses 180 on approximately **2026-12-04**. There is **no scheduled refresh** for
any source: `VehicleIntelligence` is written only by the manual seed
(`lib/amips/seed/vehicle-intelligence.seed.ts:97`) and `MarketIntelligence` only by the pipeline
behind `POST /api/admin/amips/sync-market-intelligence` — no cron drives either. Unless the source
data is refreshed, the corpus goes dark that day.

This does not create a new cliff. Gate 5 already refuses to generate or regenerate past the same
threshold (`assembler.ts:115`), so past 180 days the system can neither publish nor regenerate
these pages — **serving was the only place still ignoring it**. Regeneration will not clear the
bound either, since the as-of dates come from the source rows. Scheduling the refresh is a cron
change and deliberately out of scope for this batch.

### Staleness runway — making the bound fire with warning

Owner verification established the shape of the cliff: **all 393 servable pages share a withhold
date of 2026-12-04.** Tier B is included — its market and dealer dates are null, but
`vehicle_data_as_of` is populated on all 185 ACTIVE Tier B pages and vehicle data applies to every
tier. Every page was generated from one `VehicleIntelligence` seed run, so the corpus does not
decay page by page; it goes to 404 in a single day.

The bound is correct. The gap was that it fired silently.

| Piece | Where | Detail |
| --- | --- | --- |
| Computation | `lib/amips/staleness-runway.ts` | `computeStalenessRunway()` — pure. Min days to withhold, first withhold date, cumulative 30/60/90-day buckets, `alreadyWithheld`, and `isSingleDayCliff` |
| Emission | `app/api/cron/amips-snapshot/route.ts` | Rides in the existing `withCronRun` result JSONB → `cron_job_logs.result`. **No new table** |
| Escalation | `lib/amips/staleness-runway.service.ts` | `createAlertOnce()` + `notifyOncall()` — the platform's existing alert path |
| Admin surface | `ExecutiveIntelligenceDashboard.tsx` → `StalenessRunwayRow` | Rendered inside the Content Performance panel, beside the corpus counts |

**`isSingleDayCliff` is reported on its own** because a ramp and a cliff demand different
responses: a ramp can be absorbed page by page, a cliff cannot, and an operator reading "95 days"
should not have to infer which one they are looking at.

#### Why these thresholds — lead time is the whole point

Refreshing the source data is **not automated, and this batch does not automate it**. It requires
either running `lib/amips/seed/vehicle-intelligence.seed.ts` against production (a person, a
terminal, production DB access) or an authenticated admin `POST` to
`/api/admin/amips/sync-market-intelligence`. So the ladder is sized to **human scheduling**, not
machine reaction: each rung marks the point at which the remaining runway still permits a
particular kind of response.

| Runway | Severity | Alert level | Why this number, not a round one |
| --- | --- | --- | --- |
| > 90d | OK | none | Beyond a quarter. Alerting this far out teaches people to ignore the alert |
| ≤ 90d | NOTICE | `INFO` | One quarter — the first point at which the refresh can go **into** a planning cycle rather than interrupt one |
| ≤ 45d | WARN | `P2` | A monthly cycle **plus half**. 30 would be exactly one cycle with zero slack if that cycle is already committed |
| ≤ 21d | CRITICAL | `P1` | Three weeks covers a standard two-week absence **plus a week to act**. This is why it is not 14: a single vacation would otherwise consume the entire window |
| ≤ 0d | CRITICAL | `P0` | Pages are dark now |

`P0` is reserved for "production is degraded now". Before the cliff the platform is serving
correctly and the problem is impending, so `P1` pages without crying wolf. Escalation is expressed
through the alert **title**, which is how `health-alert.service.ts` documents breaking through an
already-open lower-severity alert.

Against the verified corpus the runway is **95 days → OK today**, tipping to `NOTICE` five days
later. The first rung fires almost immediately without any fabricated urgency.

#### Why the cron run is NOT marked FAILED

The literal reading of "escalate through cron status" is to throw so the run records `FAILED`.
Three reasons that is the wrong mechanism, in increasing order of decisiveness:

1. **It would be untrue.** The snapshot work succeeds; only a data condition is concerning. A
   `FAILED` row makes a healthy job look broken and trains operators to ignore this cron.
2. **It would destroy the payload.** `failCronRun()` **replaces** `result` with `{ build }`
   (`cron-monitor.service.ts:143-154`), discarding the very figures the signal exists to publish.
3. **It would not page anyway.** `detectFailedCrons()` requires `FAILED_CRON_STREAK_THRESHOLD`
   (2) failures inside `FAILED_CRON_LOOKBACK_MINUTES` (180) — `dead-cron.service.ts:77-79`. A
   **daily** cron's runs are 1440 minutes apart, so it can never form a 2-in-3-hours streak.
   A daily job failing once a day alerts nobody.

Reason 3 is a property of the existing detector, not an opinion, and it is pinned by a test. So
the run stays `COMPLETED` with the runway in its result, and escalation goes through
`createAlertOnce` + `notifyOncall` — the same combination `dead-cron.service.ts` uses for exactly
this shape of problem: a scheduled job surfacing a condition nobody is watching for.

`amips-snapshot` hosts it because it is the **only daily AMIPS cron**. `amips-lifecycle` is
weekly, and a weekly countdown to a single-day cliff could report "7 days left" and not fire again
until after the cliff had passed. **No cron was added** — that would be a schedule change, out of
scope.

**Not built, by instruction: the refresh cron itself.** That remains an owner decision. The signal
tells you when it is needed; it does not decide for you.

### Cadence-aware failing-cron detection

Found while investigating cron-fleet health, and fixed on this branch. It is the same
class of error as the AMIPS staleness bound: **a fixed time window cannot express a
per-run condition for jobs whose period exceeds it.**

`detectFailedCrons` demanded `FAILED_CRON_STREAK_THRESHOLD` (2) consecutive failures inside
`FAILED_CRON_LOOKBACK_MINUTES` (180). **34 of the 67 scheduled crons have a worst-case inter-run
gap larger than that window** — 18 daily, 10 weekly, 5 six-hourly, 1 four-hourly — so at most one
of their runs was ever in scope and the streak could never reach 2. Every daily and weekly job in
the fleet was structurally unalertable, `prequal-sla-escalation` and `prequal-purge` among them.

Owner-verified proof case: **`social-market-index` (weekly) has failed 100% of its recorded runs
and never produced a signal.** Dead-cron detection does not cover it either — that module's own
note (`dead-cron.service.ts:452-457`) says a cron that fires but does not succeed "reads as alive here".

**The rule.** The threshold-of-2 exists to avoid paging on a blip "the next scheduled run clears".
That is a *time* argument, not a *count* argument: it only holds if the next run arrives soon.
So demand a second failure only when the second run lands inside the base window.

| Cadence | Threshold | Lookback |
| --- | --- | --- |
| ≤ 180 min (33 crons) | **2 — unchanged** | 180 min — unchanged |
| > 180 min (34 crons) | **1** | `max(180, interval × 2)` |

Cadence comes from `CRON_STALENESS`, the registry dead-cron detection already uses and which
`cron-schedule.test.ts` pins to `vercel.json` in both directions — so a newly-scheduled cron
cannot escape this either. Two cadences of history is enough for the runs the threshold needs
plus a late fire; further back and a cron is OVERDUE, which dead-cron detection owns.

| Change | File |
| --- | --- |
| `failedStreakThresholdFor()`, `failedLookbackMinutesFor()` | `dead-cron.service.ts` |
| Two bounded queries (base window + a slow-cron window), deduped and filtered per-cron | `dead-cron.service.ts` → `detectFailedCrons` |
| Reporter and health cycle derive the threshold per cron | `dead-cron.service.ts` → `reportFailedCrons`; `health.service.ts:265` |
| Alert body names the threshold and cadence, so a "1 run in a row" alert reads correctly | `dead-cron.service.ts` |

The threshold is **not** carried on `FailedCronSignal`. It is derived from the registry at each
point of use — storing it beside its source is what let the three tier sets drift apart earlier
in this audit.

**Query shape:** two queries, not a per-cron fan-out (~34 round trips on every 5-minute health
cycle). The slow query is name-scoped and backed by `cron_job_logs_cron_name_started_at_idx`;
it returns roughly 640 rows across 14 days. The base query's cap was raised 2000 → 4000 (~3×
current fleet volume).

**Cross-reference corrected.** This fix invalidates the third justification recorded last batch
for not marking the runway cron FAILED — "it would not page anyway, because a daily cron cannot
form the streak". That is no longer true, and both the comment
(`staleness-runway.service.ts`) and the test asserting it have been rewritten to say so. The
decision itself is unchanged: reasons 1 and 2 (it would be untrue; `failCronRun` destroys the
payload) never depended on it and were always the stronger two.

**Deferred here, fixed next** — see the following section. The `RUNNING`-row half of this was
recorded as still open when the cadence fix landed; it is no longer.

### Orphaned RUNNING rows no longer clear the failure streak

The second defect in the same detector, fixed on this branch after the cadence fix.

`startCronRun` writes a `RUNNING` row and only `completeCronRun`/`failCronRun` move it
(`cron-monitor.service.ts`). Nothing reaps it. So a run killed mid-flight — a `maxDuration`
timeout, an OOM, a deploy landing mid-execution — leaves `RUNNING` behind permanently.
`leadingFailedStreak` then read that row as "not a failure" and **cleared the streak, exactly as
a `COMPLETED` run does.**

Two consequences, both silent:

- a cron alternating FAILED / killed never reaches a streak of 2, so it never alerts;
- a cron killed on **every** run has no `FAILED` rows at all — invisible to failing-cron
  detection — while dead-cron detection reads its fresh `RUNNING` row as proof of life.
  **Neither detector sees it.** This is the exact gap the cadence fix was meant to close, reached
  by a different route.

**The rule.** A `RUNNING` row means *outcome unknown*, never *succeeded*; past a bound it means
*this run died*. Three dispositions replace two:

| Row | Disposition | Why |
| --- | --- | --- |
| `FAILED` | counts | the handler threw |
| `RUNNING`, older than the bound | counts, and is tallied as abandoned | an unsuccessful run whose error was never recorded |
| `RUNNING`, within the bound | **skipped** — neither counts nor clears | the outcome is not known yet; in-flight is not evidence of recovery |
| `COMPLETED` / `SKIPPED` | clears | a genuine non-failure outcome |

**The bound: `ORPHANED_RUNNING_AFTER_MINUTES = 10`.** 300 seconds is Vercel's maximum function
duration and the highest `maxDuration` any route in this repo declares (measured across 70 cron
routes), so no run can legitimately still be executing beyond it. Ten minutes is double that
ceiling — margin for clock skew between the DB-assigned `startedAt` and the moment it is
observed. Every writer of a `RUNNING` row reaches the DB through a cron route, so the ceiling
binds all of them; the bound is derived, not guessed.

A consequence worth naming: `detectFailedCrons` executes *inside* the health cycle, so
**`health-check`'s own row is always `RUNNING` at scan time.** Breaking the streak on it meant
health-check could never report itself as failing, however many times it had. Skipping in-flight
rows fixes that too.

| Change | File |
| --- | --- |
| `ORPHANED_RUNNING_AFTER_MINUTES`, `isOrphanedRunning()` | `dead-cron.service.ts` |
| `leadingFailedStreak(runs, now)` — three dispositions; `lastError`/`lastRunAt` captured from the newest *counted* run, not the newest row | `dead-cron.service.ts` |
| `abandonedRuns?: number` on `FailedCronSignal` (optional, so hand-built signals still type-check) | `dead-cron.service.ts` |
| `describeUnsuccessfulRuns()` (verbose, notification body) and `unsuccessfulRunSummary()` (compact, health report line) | `dead-cron.service.ts`; consumed by `health.service.ts` |

**Why the run count is reported by cause.** A thrown handler and a killed run are identical in
the count and completely different in the fix — a bug versus a timeout/OOM/deploy. Both alert
surfaces now say which. Calling a mid-flight death a "failure" would send an operator hunting for
a `FAILED` row that was never written; a test pins that the two message forms agree on naming it.

### Tier F freshness: a hole FIX 2 opened, found in review

Raised by the Vercel review bot on the PR, verified against the code, and fixed here. It is a
regression **this branch introduced**, not a pre-existing defect.

FIX 2 unified the tier sets by adding F to `MARKET_DATA_TIERS`. Both freshness paths read that
set — Quality Gate 5 (`quality-gate.ts:23`, `METRO_TIERS = MARKET_DATA_TIERS`) and
`hasStaleData` (`lifecycle-manager.ts:122`) — so Tier F pages began to be checked against
`dealerDataAsOf` / `marketDataAsOf`.

**But Tier F is the one tier in that set whose source rows are optional.** It qualifies on the
transaction record alone: `tier-f-threshold.pipeline.ts:107-125` seeds its queue items from a
≥50-transaction count and never consults `amipsMarketScore` or `marketIntelligence`. The
assembler says so in its own comment — the score row is fetched "if available (not
freshness-gated for Tier F — the proven transaction record is the source of authority)" — and
`dealerCount` carries an explicit fallback for its absence. For C/D/E the question never arises:
a missing row means the page is not assembled at all (`assembler.ts:291,305` return `null`).

So `dealerDataAsOf: scoreRow?.computedAt` yielded `undefined` for any Tier F combo lacking those
rows, and that is fatal twice over:

- `isFresh(undefined)` returns `false` → Gate 5 scores 4 → **REVIEW_NEEDED at generation**;
- `ageDays(null)` returns `null` and `hasStaleData` returns `true` on it → **REFRESH_REQUIRED on
  every lifecycle run**, permanently, for a page whose data is current.

**The fix is a fallback, not an exemption.** `tierFDataAsOf()` (in `tiers.ts`, beside the set
whose change created the need) falls back to the transaction record's timestamp, which is
always present — `AutolenisIntelligence.lastUpdated` is `DateTime @default(now())` — and which
the pipeline rewrites on every aggregation. A Tier F page therefore still ages out honestly if
that aggregation stalls. Exempting F from staleness instead would have re-split the tier sets
that `tiers.ts` exists to unify.

**The test that should have caught it, didn't — and why.** `lifecycle-staleness.test.ts`
asserted the literal keys `dealerDataAsOf:` / `marketDataAsOf:` appeared in the Tier F branch.
That pins the *syntax*, not the guarantee: `dealerDataAsOf: scoreRow?.computedAt` matched it
while still yielding `undefined`. The assertion now requires the branch to route through
`tierFDataAsOf()`, which cannot return a null — verified to be strictly stronger by running the
corrected assertion against the original defective code, where it fails and the old one passed.
Behaviour is covered directly in `tier-f-freshness-fallback.test.ts`.

**Not done, and still open: nothing reaps the orphaned rows.** This change corrects how they are
*interpreted*; the rows themselves still sit in `cron_job_logs` as `RUNNING` forever. Reaping
them is a change to cron-monitor's run lifecycle — a different surface, and not what was asked
for here.

### Branch-by-branch closure — answering V-2's goal directly

V-2 warned that closing one expression must not leave another open. Against the six branches
enumerated there:

| Branch | Before | After | How |
| --- | --- | --- | --- |
| S-1 vehicle > 180d | → 404 | **harm closed** | still flags `REFRESH_REQUIRED`, which now serves |
| S-2 Tier C+ dealer null/>90d | → 404 | **closed** | Tier F dates populated (FIX 2); `REFRESH_REQUIRED` serves (FIX 3) |
| S-3 Tier C+ market null/>30d | → 404 (the 208) | **closed** | as S-2 |
| S-4 `noImpressions` 180d, armed 2026-12-05 | → 404 en masse | **harm closed** | it routes to `REFRESH_REQUIRED`, which no longer 404s. The mass event still fires as a *refresh flag*, which is the correct meaning |
| S-5 duplicate cluster | → 404 (the 31) | **cause removed** | FIX 1 stops the duplicate being emitted. The demotion itself was correct and is retained — now audited with reason `duplicate_cluster` |
| S-6 leads ratio | latent, would arm with the GSC sync | **closed** | FIX 4 gates on measurement availability |
| S-7 `RETIRED` 365d | keyed on always-zero traffic | **OPEN — out of authorized scope** | see below |

**S-7 is the one branch this batch does not close.** `traffic365`, `p.impressions` and `p.clicks`
all read zero for every page while the Search Console sync returns `synced: 0`, so it cannot
distinguish "no traffic" from "no measurement" — the same defect FIX 4 corrects for S-6. It is
unreachable until a page is 365 days old (earliest cohort **2027-06-08**) and only applies to
pages already withheld from the index, so nothing is at risk today. It is flagged in-code at the
branch and needs the same measurement-available guard before that date.

Note the shape of the FIX 3 result: because S-1…S-4 all route to `REFRESH_REQUIRED`, making that
status servable closed four branches with one change rather than four separate guards.

**Deliberately NOT changed** (out of the authorized scope): the `/intelligence/` filter at
`pipeline.ts:172`; the `/g`-flag regex defect in `quality-gate.ts:37,39`; the `content-validation`
duplicate layer (`05`, R-2); the `amips-lifecycle` cron schedule.

### Regression coverage

42 tests across 6 suites in `lib/amips/__tests__/`, wired into `test:amips`
(`test:coverage-check` green: 272/272 reachable). **Three suites were proven failing-first by
reverting the corresponding fix and re-running:**

| Suite | Against pre-fix code | Failure surfaced |
| --- | --- | --- |
| `duplicate-emission.test.ts` | **1 fail / 9** | `duplicate keywordTargets: Ford F-150 deals in New York, …` |
| `lifecycle-staleness.test.ts` | **1 fail / 14** | `Tier F return omits dealerDataAsOf` |
| `lifecycle-audit.test.ts` | **4 fail / 5** | `lifecycleStatus write to REFRESH_REQUIRED has no record() call` |

`tiers.test.ts` pins the three tier sets together so they cannot drift apart again.

---

## Required tests
| Test | Asserts |
| --- | --- |
| `hasStaleData` with Tier F + null `dealerDataAsOf`/`marketDataAsOf` | does **not** return `true` after C-3 |
| `runLifecycleReview` with empty `searchIntelligence` | flags **nothing** via S-4/S-7 (currently would flag everything past 180d) |
| `runLifecycleReview` with `clicks=0, leadsGenerated=0`, age > 90d | does **not** flag `UNDER_REVIEW` — the V-3 regression test |
| Duplicate clustering with all-zero `impressions` | canonical selection is deterministic and documented |
| Assembler Tier F return | includes both as-of dates (if C-3 is solved at the assembler) |
| Tier-set parity | `assembler.METRO_TIERS`, `quality-gate.METRO_TIERS`, `lifecycle.isTierCPlus` agree — a guard test so they cannot drift again |

## Production data repair
**Required, but only after the code correction ships.** Repairing first guarantees re-demotion at
the next Tuesday run. Sequence: pause cron → ship C-1…C-4 → verify against a snapshot → repair
`lifecycle_status` for pages demoted solely by a defective branch → resume cron.
`quality_gate_status` is untouched by all three lifecycle writers, so **`quality_gate_status =
'PUBLISHED'` is a reliable marker of a page the generator certified**, which makes the repair
population identifiable without guesswork.

## Rollback
| Action | Rollback |
| --- | --- |
| Pause cron | re-add the `vercel.json` entry |
| C-1…C-4 | ordinary revert; transitions are pure status writes, no deletes (`lifecycle-manager.ts:117-118`) |
| Data repair | **capture `(id, lifecycle_status)` for every touched row before writing** — there is no history table and the lifecycle manager writes no audit record, so this snapshot is the only rollback path |

**Recommended follow-up (not in this remediation):** the lifecycle manager should write an audit
record per transition. Its absence is why V-1's responsible *run* is unidentifiable, and it will
recur on the next incident.
