# Dealer Inventory → Matching → Auction → Offer → Deal — Investigation

**Date:** 2026-08-28 · **Scope:** read-only investigation, no code changed
**Production database:** Supabase project `aieybibvewmvrubcpthm` (queried directly)
**Repo state:** branch `claude/dealer-inventory-matching-investigation-n9ipg8`, base `b059a4b`

---

## 0. Method and evidence basis

Every conclusion below carries either a `file:line` reference read in this session or a SQL
query run against production and its actual result. Nothing is concluded from a filename, a
comment, a TODO, a test name, UI copy, or an HTTP 200.

Physical schema was verified from `information_schema.columns`, `pg_indexes`, `pg_class`, and
`pg_policies` — **not** from `prisma/schema.prisma` and not from `_prisma_migrations`.
`cron_job_logs` was used as the authoritative record of whether a scheduled job ever ran.

### Verification caveat — read this before relying on any single finding

This investigation ran in two passes:

1. **Direct trace (orchestrator).** Everything in §2–§10 marked **[verified here]** was read and
   run by me in this session — code opened at the cited lines, SQL executed, results reproduced.
2. **Parallel tracer workflow.** A 10-agent workflow traced the same chain in breadth. It
   completed all 10 tracer agents, but **156 of its 231 agents failed on a session-usage limit** —
   which killed essentially the entire adversarial-verification stage and the completeness critic.

Consequently **the tracer findings were NOT adversarially verified by the workflow.** Before
writing this report I personally re-verified every load-bearing tracer claim (the ones that change
the verdict or carry P0/P1 severity). Those are marked **[verified here]**. Tracer findings I did
*not* re-verify are quarantined in §11 and are explicitly **NOT VERIFIED** — do not action them
without checking first. Two tracer claims were **overstated and are corrected** in §11.

---

## 1. Corrections to the briefing's established context

The briefing asked me to confirm or refute two items from the database, and to take three others
as given. One of the "given" items does not match production and materially changes the picture.

| Briefing statement | Production reality | Verdict |
| --- | --- | --- |
| All 206 `inventory_items` rows have `dealer_id = NULL` | 206/206 confirmed | **CONFIRMED** |
| Both dealers: 0 agreement signatures, 0 verified licenses, `marketplaceAgreementSignedAt` NULL, 0 owned inventory | All four confirmed for both dealers | **CONFIRMED** |
| All dealer-creation paths set `PENDING`; `PENDING` is in `BLOCKED_STATUSES`; circular deadlock | **Both production dealers are `status = ACTIVE`.** | **Does not currently bind** |

```sql
SELECT d.dealership_name, d.status::text, d.onboarding_step, d.marketplace_agreement_signed_at,
       d.latitude, d.longitude, d.current_auction_load,
       (SELECT count(*) FROM inventory_items i WHERE i.dealer_id=d.id) owned_inventory,
       (SELECT count(*) FROM dealer_agreement_signatures s WHERE s.dealer_id=d.id) sigs,
       (SELECT count(*) FROM dealer_licenses l WHERE l.dealer_id=d.id) licenses
FROM dealers d;
```
| dealership_name | status | onboarding_step | agreement_signed | lat | lng | load | inventory | sigs | licenses |
|---|---|---|---|---|---|---|---|---|---|
| Athelus Motors LLC | **ACTIVE** | COMPLETE | NULL | NULL | NULL | **-4** | 0 | 0 | 0 |
| AutoLenis Dealers | **ACTIVE** | BUSINESS_INFO | NULL | NULL | NULL | 0 | 0 | 0 | 0 |

**Why this matters:** the PENDING/`BLOCKED_STATUSES` deadlock is real for *new* dealers, but it is
**not** what blocks the two dealers that exist today. They can sign in and reach every dealer
surface (`proxy.ts:451` gates `/dealer*` on the dealer JWT; `lib/auth/dealer-session.ts:15,32,50`
blocks only SUSPENDED/TERMINATED/PENDING). So the blockers found below are the *operative* ones,
not a downstream consequence of the signup deadlock.

Two further facts that change how other findings should be read:

- **The dealer verification gate is OFF.** `filterAuctionEligibleDealerIds`
  (`lib/services/dealer/dealer-auction-eligibility.service.ts:44-47`) is a no-op unless
  `FLAGS.DEALER_VERIFICATION_GATE` is enabled. `SELECT * FROM feature_flags` returns **0 rows** →
  default OFF. The "0 signatures, 0 verified licenses" facts therefore do **not** currently block
  invitations.
- **`dealer_licenses` has no verification-status column at all** (`information_schema.columns`:
  `id, dealer_id, license_number, state, expires_at, document_url, created_at, updated_at`), so
  "verified license" is not physically representable today.

---

## 2. Q1 — Inventory entry: which surfaces actually persist rows?

**Authoritative model: `InventoryItem` / `inventory_items`.** Every dealer-facing write path in
the app targets this one model — there is no second or parallel inventory model. Proven by
enumerating every write call site:

```
$ grep -rn "inventoryItem\.\(create\|createMany\|upsert\|update\|updateMany\|delete\)" app lib scripts
app/api/dealer/inventory/route.ts:58              create   (dealerId set)
app/api/dealer/inventory/bulk/route.ts:181        createMany (dealerId set)
app/api/dealer/inventory/column-mapping/route.ts:165 createMany (dealerId set)
app/api/dealer/inventory/[id]/route.ts:28,53      update / updateMany
app/api/admin/inventory/route.ts:88               create
app/api/admin/inventory/bulk-upload/route.ts:86   create
app/api/admin/inventory/search-tool/add/route.ts:48 create
app/api/admin/inventory/[id]/route.ts:67,123      update / delete
app/api/admin/inventory/bulk-lane/route.ts:48     updateMany
app/api/cron/inventory-stale-sweep/route.ts:40    updateMany
lib/services/inventory/orchestrator.ts:196,232,262 upsert / create / updateMany
```

All columns these handlers write exist physically in `inventory_items` (38 columns confirmed via
`information_schema.columns`). The failures below are logic defects, not schema drift.

| Entry surface | Classification | Evidence |
| --- | --- | --- |
| Manual add (`/dealer/inventory/add`) | **VERIFIED BROKEN** | see 2.1 |
| Edit (`/dealer/inventory/[id]/edit`) | **VERIFIED BROKEN** | see 2.2 |
| VIN decode (`/api/dealer/inventory/vin-decode`) | **PARTIAL** | see 2.3 |
| CSV bulk, standard headers | **PARTIAL** | see 2.4 |
| CSV bulk, mapped headers | **VERIFIED BROKEN** | see 2.5 |
| Scheduled DMS feed (`/dealer/inventory/feed-setup`) | **NOT WIRED** (honestly labelled) | see 2.6 |
| Import history (`/dealer/inventory/import-history`) | **NOT WIRED** | see 2.7 |
| DMS/API ingestion under any name | **NOT WIRED** | see 2.6 |
| Inventory list / detail (read) | **VERIFIED WORKING** | `app/dealer/inventory/page.tsx:13-15` scopes `where: { dealerId: dealer.id }` |

### 2.1 Manual add can never persist a row — **[verified here]**

`app/dealer/inventory/add/page.tsx:8` defines `const CONDITIONS = ["Excellent","Good","Fair","Poor"]`,
`:26` defaults state to `"Good"`, and `:60-70` posts `condition` **and** `description`.

`app/api/dealer/inventory/route.ts:22-34` defines the schema as
`condition: z.enum(["NEW","USED","CPO"]).optional()` inside a **`.strict()`** object — `description`
is not a member. `:42-44` returns 422 on any parse failure.

Reproduced against the repo's own zod (3.25.76) with an otherwise perfectly valid payload:

```
success: false
[ { code: 'invalid_enum_value', path: ['condition'], received: 'Good',
    message: "Invalid enum value. Expected 'NEW' | 'USED' | 'CPO', received 'Good'" },
  { code: 'unrecognized_keys', keys: ['description'],
    message: "Unrecognized key(s) in object: 'description'" } ]
```

Two independent rejections; the form has no code path that avoids either. Production corroborates:
`SELECT count(*) FROM inventory_items WHERE source_adapter='dealer_manual'` → **0**, even though
`route.ts:74` stamps that value on every successful create.

### 2.2 Edit page — **[verified here]**

`app/dealer/inventory/[id]/edit/page.tsx:1` is `"use client"`; `:24-25` declares
`interface Props { params: { id: string } }` and `:31` destructures `const { id } = params;`
synchronously. The installed Next is **16.2.9** (`require('next/package.json').version`), which
delivers client-segment params as a promise. This file is the **only** page under `app/dealer`
using a synchronous `params: {` object — every sibling dynamic page uses `params: Promise<…>`.

Independently of that, the PATCH schema at `app/api/dealer/inventory/[id]/route.ts:8` is
`z.object({ priceCents, mileage, description, isActive })` and is **not** `.strict()`, so zod
silently strips `vin/year/make/model/trim/condition` — the form sends them, they are discarded,
and the route returns 200. So even with a correct `id`, most edits are silently no-ops.

### 2.3 VIN decode — PARTIAL

Real provider, real call: `app/api/dealer/inventory/vin-decode/route.ts:26-29` fetches NHTSA vPIC
with an 8s `AbortSignal.timeout`, auth-gated at `:12-13`, VIN alphabet enforced at `:21-23`. It
imports no Prisma client and **never persists** — correct for a decode helper. Classified PARTIAL
only because both of its consumers (the add and edit forms) cannot save (2.1, 2.2).

### 2.4 CSV bulk upload, standard headers — PARTIAL, with a 100× money bug — **[verified here]**

The server path is sound: `app/api/dealer/inventory/bulk/route.ts:181-199` `createMany` with
`dealerId`, `lane: "LANE_1"`, `sourceAdapter: "dealer_csv"`, `lastSeenAt: new Date()`,
`skipDuplicates: true`. Dealer-scoped duplicate pre-check at `:164-170`.

The **client** corrupts price. `app/dealer/inventory/bulk-upload/page.tsx:27-34`:

```ts
function convertToPriceCents(priceStr: string): number {
  const cleaned = priceStr.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return 0;
  if (priceStr.includes(".")) return Math.round(num * 100);
  return num < 10000 ? Math.round(num * 100) : Math.round(num);   // ← line 33
}
```

| CSV cell | stored `priceCents` | means | correct? |
| --- | --- | --- | --- |
| `25000` | 25000 | **$250.00** | ✗ 100× low |
| `$25,000` | 25000 | **$250.00** | ✗ (`.includes(".")` tests the *raw* string, which has no dot) |
| `45999` | 45999 | **$459.99** | ✗ |
| `25000.00` | 2500000 | $25,000.00 | ✓ |
| `9500` | 950000 | $9,500.00 | ✓ |

Whole-dollar prices without decimals — the ordinary way car prices are exported — are stored at
1/100 of value for anything ≥ $10,000. The preview table at `:253` renders
`$${parseInt(row.price).toLocaleString()}` = "$25,000", so the dealer is shown the correct number
while the wrong one is saved. The raw-rows server path (`bulk/route.ts:93`) always does
`parseFloat × 100`, so the two CSV paths disagree by 100×.

### 2.5 CSV bulk upload, mapped headers — VERIFIED BROKEN — **[verified here]**

`app/api/dealer/inventory/column-mapping/route.ts:195-201` writes the mapping cookie with
**`path: "/dealer"`**. The only consumer reads it at
`app/api/dealer/inventory/bulk/route.ts:41-42` on request path `/api/dealer/inventory/bulk`.
Per RFC 6265 §5.1.4 the cookie-path must equal the request path or be a prefix of it at a `/`
boundary — `/api/dealer/inventory/bulk` does not start with `/dealer`, so the cookie is **never
transmitted**. `readMappingCookie` returns null → `bulk/route.ts:136-142` returns
`MAPPING_REQUIRED` 409 unconditionally, forever. No rewrite rescues it (`grep -n rewrite proxy.ts`
and `grep -n rewrites next.config.mjs` both return nothing).

### 2.6 Feed / DMS ingestion — NOT WIRED (and honestly labelled)

`app/dealer/inventory/feed-setup/page.tsx:1-9` is a static "coming soon" page with no API call —
its header comment records that it previously showed fake success and was deliberately gated.
This is the correct behaviour, not a defect.

`DealerFeedConfig` is written only at `app/api/dealer/onboarding/route.ts:149` and read only by
`app/api/cron/inventory-stale-sweep/route.ts:76` (to *suppress* a false alarm) and the admin
console. Nothing pulls a dealer feed. `SELECT count(*) FROM dealer_feed_configs` → **0**.
`CustomAdapter` exists (`lib/services/inventory/adapters/custom.adapter.ts`) but the orchestrator
registers only MarketCheck.

### 2.7 Import history — NOT WIRED

`app/dealer/inventory/import-history/page.tsx:6-21` is `requireDealer()` followed by a hardcoded
empty state. It queries nothing. Separately, the dealer bulk route never writes an
`InventoryUploadBatch` — only `app/api/admin/inventory/bulk-upload/route.ts:126` does — so there
would be nothing to show even if it were wired.

---

## 3. Q2 — Ingestion integrity

**Validation.** Three dealer write paths, three different VIN rules, all feeding one globally
unique column:

| Path | VIN rule | Normalized? |
| --- | --- | --- |
| `app/api/dealer/inventory/route.ts:28-30` | `isValidVin` → `/^[A-HJ-NPR-Z0-9]{17}$/` (`lib/utils/vin.ts:8`) | yes, `normalizeVin` |
| `app/api/dealer/inventory/bulk/route.ts:23` | `z.string().min(11).max(17)` | **no** |
| `app/api/dealer/inventory/column-mapping/route.ts:66` | `vin.length < 11 \|\| > 17` | **no** |

So bulk accepts an 11-character string, mixed case, or characters outside the VIN alphabet, and
writes it into the unique slot. The orchestrator explicitly refuses to do this
(`lib/services/inventory/orchestrator.ts:187-188` falls malformed VINs through to the no-VIN path
"so it can never collide with or overwrite a valid record") — the dealer path has no such guard.

**Dedup key.** Physical: `inventory_items_vin_key UNIQUE (vin)` — **global, not scoped to
dealer**. Consequence: an orphan scraped row permanently blocks a dealer from listing that VIN.
The single-add path returns a clean 409 (`route.ts:80-82`); the bulk path passes
`skipDuplicates: true` (`:198`) so the row is **silently dropped and counted as "skipped"** with
no explanation.

**Update-vs-insert.** `orchestrator.ts:196-229` upserts on `where: { vin }` with **no `dealerId`
guard**, and its `update` block (`:219-228`) overwrites `priceCents`, `mileage`, `images`,
**`lane`**, and **`sourceAdapter`**. A dealer-entered LANE_1 / `dealer_manual` row whose VIN later
appears in a MarketCheck response is therefore demoted to LANE_2/LANE_3 with external provenance
and external pricing. `dealerId` survives (it is not in the update), which makes the resulting row
internally contradictory.

**Soft-delete / sold.** `is_active boolean NOT NULL` is the only archive flag — there is no
`sold_at` or status column (`information_schema.columns` for `inventory_items`). Dealer delete is
a soft delete scoped correctly: `app/api/dealer/inventory/[id]/route.ts:53-56` `updateMany
where { id, dealerId }`.

**Staleness.** Defined as `lastSeenAt < now − 48h` in three separate places, each a bare literal:
`app/api/cron/inventory-stale-sweep/route.ts:21`, `lib/services/inventory/orchestrator.ts:261`,
and `lib/services/inventory/inventory-eligibility.ts:23` (`FRESHNESS_WINDOW_MS`). Enforced by the
`inventory-stale-sweep` cron every 30 min, **but it excludes LANE_1** (`route.ts:28,43`,
`orchestrator.ts:263`).

The sweep's `deactivated: 0` is therefore **correct behaviour, not a silent no-op** — I verified
this rather than assume it:

```sql
SELECT count(*) FILTER (WHERE is_active AND last_seen_at < now() - interval '48 hours') stale_active,
       count(*) FILTER (WHERE is_active) active_total, max(last_seen_at) newest, now() db_now
FROM inventory_items;
-- stale_active=94, active_total=95, newest=2026-06-18 19:01:34, db_now=2026-08-28 00:02:23
```

All 95 active rows are LANE_1, so the sweep matches none of them. The real problem is what that
implies (§4).

**Ingestion is currently dead.** `inventory_sources` holds one row (MarketCheck,
`last_run_status = DEFERRED`). `SELECT status::text, count(*), min(started_at), max(started_at),
count(*) FILTER (WHERE completed_at IS NULL) FROM inventory_sync_runs GROUP BY 1` →
**108 rows, all `DEFERRED`, none incomplete**, spanning 2026-08-24 → 2026-08-28. Every
`inventory-sync-full` / `inventory-sync-priority` cron result carries
`"error":"MarketCheck HTTP 429: Too Many Requests"`, `upserted: 0`. Nothing has been ingested for
at least four days, and the newest `last_seen_at` in the table is **2026-06-18** — 71 days stale.

Note the observability consequence: a 100%-failed sync is recorded in `cron_job_logs` with
`status = COMPLETED` (the run "succeeded" in returning a DEFERRED outcome), so cron monitoring
cannot flag it. `SELECT status::text, count(*) FROM cron_job_logs GROUP BY 1` →
`COMPLETED 51974 / FAILED 325`; none of the 189+31 deferred sync runs is among the failures.

---

## 4. Q3 — Where the 206 `dealer_id`-NULL rows come from, and whether dealer inventory can reach the table

### They are external scraped listings, written by the orchestrator — **[verified here]**

```sql
SELECT count(*) total,
       count(*) FILTER (WHERE dealer_id IS NOT NULL) has_dealer,
       count(*) FILTER (WHERE source_adapter IS NOT NULL) has_source,
       count(*) FILTER (WHERE added_by_admin_id IS NOT NULL) has_admin,
       count(*) FILTER (WHERE dealer_id IS NULL AND source_adapter IS NULL
                          AND added_by_admin_id IS NULL) orphan
FROM inventory_items;
-- total=206, has_dealer=0, has_source=0, has_admin=0, orphan=206
```

205 of the 206 carry `external_listing_url`, `external_dealer_name`, **and** a populated
`price_history` array. Those three fields are written **only** by the orchestrator's adapter path
(`lib/services/inventory/orchestrator.ts:196-251`). `source_adapter` is NULL because the rows
predate the provenance work that added it (`orchestrator.ts:211,226,245`).

### The LANE_1 badge came from one admin bulk lane move — **[verified here]**

The current `assignLane` (`orchestrator.ts:68-81`) can only return LANE_2 or LANE_3 — it never
returns LANE_1. So the 95 LANE_1 rows were moved there afterwards. The audit log names the event
exactly:

```sql
SELECT action, count(*), min(created_at), max(created_at)
FROM admin_audit_logs WHERE entity_type='InventoryItem' GROUP BY 1;
-- INVENTORY_ITEM_LANE_CHANGED  123  2026-06-23 01:36:53.067  2026-06-23 01:36:53.067
```

123 rows, all at a single timestamp — one transaction, i.e.
`app/api/admin/inventory/bulk-lane/route.ts:47-61`. Joining those audit rows back to the table:
**86 are now LANE_1 & active**, 37 are LANE_3 & inactive.

This is the P0 in this section: LANE_1 renders to the public as
**"Verified — Directly from a verified AutoLenis dealer partner"**
(`app/(public)/inventory/page.tsx:38`, `app/buyer/inventory/[vehicleId]/page.tsx:32`), the public
browse query filters on **`isActive: true` only** (`app/(public)/inventory/page.tsx:56,77`), and
LANE_1 is permanently exempt from the stale sweep. So 95 unowned scraped listings, last seen
71 days ago, are shown to buyers as dealer-verified live inventory, forever.

### Can dealer-owned inventory reach the table at all?

**Yes in principle, and it would immediately qualify as executable supply** — but only via one
working path. A row written by `app/api/dealer/inventory/route.ts:58-77` or
`bulk/route.ts:181-199` carries `dealerId`, `sourceAdapter`, `isActive: true`,
`lastSeenAt: now`, `priceCents > 0` and therefore satisfies all four clauses of
`executableSupplyWhere` (§5). Of the four dealer write paths, three are broken (§2.1, §2.2, §2.5)
and the fourth corrupts price (§2.4). `dealer_id` is **nullable** with FK
`inventory_items_dealer_id_fkey → dealers(id)`.

---

## 5. Q4 — Matching: what actually selects dealers, and does inventory influence it?

### The selector — **[verified here]**

`inviteDealersToAuction` (`lib/services/auction/dealer-invitation.service.ts:150`) is the only
scored selector. Its dealer query is, in full:

```ts
// dealer-invitation.service.ts:213-216
let dealers = await prisma.dealer.findMany({
  where: { status: "ACTIVE", isSystemPlaceholder: false },
  select: { id: true, zip: true, latitude: true, longitude: true },
});
```

**Inventory is not read — not here, not in scoring, not in ranking.** `scoreDealerForAuction`
(`:42-77`) uses only: base 50, tier bonus (`PLATINUM 30 / GOLD 20 / STANDARD 10 / PROBATION −20`),
`− currentAuctionLoad × 5`, hard zero at `load >= 5`, scorecard `offerWinRate × 20` and
`− junkFeeRatio × 15`, and `MAKE_MATCH_BONUS 25` for a self-declared preferred-make overlap.
Selection then takes `score > 0`, sorts desc, and slices `MAX_INVITATIONS_PER_AUCTION = 8` (`:252-255`).

**Freshness and availability influence nothing.** No inventory table, column, or service is
referenced anywhere in the selection or ranking path.

Three separate UI surfaces tell dealers the opposite:

- `app/dealer/auctions/invited/page.tsx:53` — "Invitations are matched to your inventory, tier, and capacity."
- `app/dealer/opportunities/page.tsx:188` — "Opportunities are matched to your inventory, location, and tier."
- `app/dealer/auctions/page.tsx:229` — "Invitations are sent based on your inventory match, tier, and capacity."

### The matching engine that does exist writes to nothing — **[verified here]**

`matchInventoryForRequest` (`lib/services/inventory/request-inventory-match.service.ts:79`) is
real, careful code: it counts executable supply (`:98`), distinguishes `NO_ELIGIBLE_SUPPLY` from
`ZERO_MATCHES` (`:99-113`), scores and persists into `VehicleRequestMatchResult` (`:157`).

But **nothing reads its output.** Exhaustive grep for readers of both match sinks returns writers
and tests only:

```
vehicleRequestMatchResult → written at request-inventory-match.service.ts:157,164,166; read: none
vehicleMatchScore         → written at inventory-match.service.ts:59;                  read: none
findMatchedVehicles (buyer-facing matcher, inventory-match.service.ts:23) → zero callers outside tests
saveVehiclePreferences   (:82)                                            → zero callers
computeQualityScore (inventory-quality.service.ts:4)                      → zero callers
```

Production: `vehicle_match_scores` = 0, `vehicle_request_match_results` = 0,
`inventory_quality_scores` = 0, `buyer_inventory_preferences` = 0. `inventory_feed_logs` and
`inventory_price_alerts` have **no writer anywhere in the codebase** and are 0 rows.

### Executable supply is exactly zero — **[verified here]**

`lib/services/inventory/inventory-eligibility.ts:33-45` is the single eligibility gate. Its own
header comment (`:10-12`) acknowledges the situation: *"Orphan rows with NONE of these (e.g. the
historical 206 unowned items whose provenance was dropped before Batch 1) are NEVER treated as
executable supply."* Translated to SQL and run against production:

```sql
SELECT count(*) AS executable_supply FROM inventory_items
WHERE is_active = true AND price_cents > 0
  AND (dealer_id IS NOT NULL OR source_adapter IS NOT NULL OR added_by_admin_id IS NOT NULL)
  AND (lane::text = 'LANE_1' OR last_seen_at >= now() - interval '48 hours');
-- executable_supply = 0
```

This is the proximate cause of the cron's own report. The last `inventory-match-refresh` run
logged `{"processed":17,"noSupply":17,"matched":0,"zeroMatches":0}` — i.e. all 17 non-terminal
requests hit the `eligibleSupply === 0` branch at `request-inventory-match.service.ts:99-102`.

### Geography is the operative selection filter, and it is fragile — **[verified here]**

Buyer coords resolve via ZIP geocode then a static city table (`:181-186`); with neither, the
function **fails closed and returns 0** (`:199-210`). Dealer coords resolve from persisted
lat/lng, else a live ZIP geocode (`:230-240`); `pickNearbyDealers` (`:98-109`) excludes any dealer
with no coords.

Both production dealers have **NULL lat/lng**, so every invitation depends on
`geocodeZip('75035')`. That resolves only from the `SearchCache`:

```sql
SELECT cache_key, result, expires_at FROM search_cache WHERE search_type='geocoding';
-- geocoding:zip:75035 → {lat:33.1541165, lng:-96.7601057}  expires 2026-11-21
-- geocoding:zip:33068 → {lat:26.2153627, lng:-80.2209773}  expires 2026-11-23
```

`75035` is **not** in the static `ZIP_COORDS` table (173 entries) and `frisco,tx` is not in
`CITY_COORDS` (127 entries) — verified by parsing `lib/utils/zip-coords.ts`. So dealer selection
currently rests on one cache row that expires 2026-11-21, after which it needs a live Google call.

The cron that would persist dealer coordinates permanently, `app/api/cron/geocode-backfill`,
**is not registered in `vercel.json`** (`grep -c geocode-backfill vercel.json` → **0**) and has
zero `cron_job_logs` rows. It has never run.

---

## 6. Q5 — The $99 gate: can invitations happen before a deposit reaches PAID?

### The buyer-driven path is correctly gated — **[verified here]**

`app/api/webhooks/stripe/route.ts:156-190` advances the deposit to PAID **inside a transaction**
using a state-machine-guarded `updateMany` (`:156-159`), creates the auction in the same
transaction (`:178-184`), and only then, post-commit, calls `launchAuction` and
`inviteDealersToAuction` (`:228-235`). `app/api/admin/auctions/route.ts:36-37` independently
requires `status: "PAID"` and 400s otherwise.

Empirically the invariant holds across every row in production:

```sql
SELECT a.id, a.status::text, a.created_at, a.vehicle_request_id, d.status::text deposit_status,
       (SELECT count(*) FROM auction_invitations ai WHERE ai.auction_id=a.id) invites
FROM auctions a LEFT JOIN deposits d ON d.id=a.deposit_id ORDER BY a.created_at;
```
All 7 auctions link to a **PAID** deposit. The one PENDING deposit (`77934f10`, 2026-05-31) has
**0** auctions. `auctions_deposit_id_key UNIQUE (deposit_id)` enforces one auction per deposit.

### But "PAID" is not proof of payment — **[verified here]**

`app/api/admin/buyers/[buyerId]/launch-auction/route.ts:134-144`:

```ts
let deposit = await prisma.deposit.findFirst({
  where: { buyerId, status: "PAID", auction: null }, select: { id: true },
});
if (!deposit) {
  deposit = await prisma.deposit.create({
    data: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, status: "PAID" },   // ← no Stripe artifact
    select: { id: true },
  });
}
```

The route mints the very deposit it is gated on, then creates the auction (`:150-151`),
batch-inserts `AuctionInvitation` rows (`:165-172`), bumps dealer load (`:175-178`), and emails
outside dealers. Its guard is `getAdminFromRequest` (`:3`) — **any** admin, with no role
restriction (contrast `bulk-lane/route.ts:18`, which uses `getAdminWithRole(request,
OPERATIONAL_ROLES)`).

Production shows this path has been used: of the 8 deposits, **3 PAID rows have neither a
`stripe_payment_intent_id` nor a `stripe_session_id`** (`ac00344b`, `bc605805`, `1d33be09`), and
**no deposit has a `stripe_session_id` at all**.

Note also that these admin-created invitations carry `invitation_score = NULL` (the route never
computes one) — visible in the data below.

### Consequence for the buyer

`app/api/buyer/deposit/create-intent/route.ts:85-91` blocks a new intent whenever the buyer
already has a PAID deposit. A buyer whose deposit was admin-minted therefore can never actually
pay, while the system treats them as paid.

### Paid dealer-contact acquisition

No per-request paid reveal is triggered by an unpaid buyer request. The only Apollo spend path is
the standalone budget-gated `dealer-contact-backfill` cron (header at `route.ts:5-7`: "gated
Apollo path (consumer=backfill → leftover budget only, above the live reserve). Idempotent +
fail-closed: OFF unless Apollo is enabled"). Its last run reported
`{"attempted":100,"skipped":100,"revealed":0}`. **No material finding.**

---

## 7. Q6 — Offer submission

### The service layer is genuinely sound — **[verified here]**

`submitOffer` (`lib/services/offer/offer.service.ts:70-133`) wraps invitation membership, auction
validation, duplicate check and insert in a **single `Serializable` transaction** (`:87`, `:133`):

- invitation membership — `:88-91`, `findFirst({ auctionId, dealerId })`, throws if absent
- window — `:93-95`, requires `status === "ACTIVE"` and `endsAt >= now`
- duplicate — `:97-106`, rejects an existing `SUBMITTED` offer for this (auction, dealer)
- insert + `invitation.respondedAt` — `:108-130`, same transaction

`reviseOffer` (`:253-311`) is equally careful, also `Serializable`. Post-transaction work
(notification, emails, QStash) is best-effort and cannot leave a partial money/state record.

Residual weaknesses, honestly small: there is **no DB unique index on `offers(auction_id,
dealer_id)`** (confirmed in `pg_indexes` — `offers` has only `offers_pkey` and
`offers_original_offer_id_key`), so the duplicate guarantee rests entirely on isolation level; and
the duplicate check is scoped to `SUBMITTED` only, so a WITHDRAWN revision does not block a fresh
version-1 insert.

### But the only submit UI crashes before a dealer can use it — **[verified here]**

`app/dealer/quick-offer/[auctionId]/page.tsx:118` is the **sole** caller of
`POST /api/dealer/offers` in the entire application:

```
$ grep -rn '"/api/dealer/offers"' app components
app/dealer/quick-offer/[auctionId]/page.tsx:118:      await api.post("/api/dealer/offers", body);
```

That page loads its context from `GET /api/dealer/auctions/[auctionId]` and reads:

```ts
// quick-offer/[auctionId]/page.tsx:24
_count: { offers: number };
// :176
<div …>{auctionCtx._count.offers} offer{auctionCtx._count.offers !== 1 ? "s" : ""} so far</div>
```

The API deliberately strips that key and renames it:

```ts
// app/api/dealer/auctions/[auctionId]/route.ts:113,117
const { buyerId: _buyerId, _count, ...auctionPublic } = auction;
… auction: { ...auctionPublic, offerCount: _count.offers },
```

The response has `offerCount`, never `_count`. `auctionCtx._count` is `undefined`, and `:176`
dereferences `.offers` on it — a `TypeError` during render of a client component. **The one path
by which a dealer can submit an offer throws on load.**

### Which stack produced the real production offers — **[verified here]**

`offers` = **0 rows, ever**, against 6 invitations. Every real dealer offer came through the
admin-driven concierge stack:

```sql
SELECT s.dealership_name, s.dealer_id, s.submitted_at, s.invite_id,
       i.status::text invite_status, i.dealer_email, i.opened_at
FROM dealer_offer_submissions s LEFT JOIN vehicle_offer_dealer_invites i ON i.id = s.invite_id;
```
| dealership_name | dealer_id | submitted_at | invite_status | dealer_email | opened_at |
|---|---|---|---|---|---|
| Athelus Motors LLC | **NULL** | 2026-05-15 16:23 | submitted | markist@protecwise.com | 2026-05-15 16:20 |
| Athelus Motors LLC | 638d9cb3… | 2026-05-30 02:21 | (no invite) | — | — |

The first arrived via an emailed tokenized link (`/api/public/dealer-offer/[token]`), opened and
submitted — and its `dealer_id` was **never backfilled**, so the registered dealer's own
submission is invisible to them in the portal (`app/api/dealer/offers/route.ts:30-34` filters
`where: { dealerId: dealer.id }`).

### The public token endpoint is under-defended — **[verified here]**

`app/api/public/dealer-offer/[token]/route.ts` is token-gated (`:110-124` → 404 without a valid
token) and checks expiry (`:126-132`). It then creates the submission at `:179-190`
**without ever checking `invite.status`**, so one token can be replayed to create unlimited
`DealerOfferSubmission` rows. It has **no rate limiter**, while its sibling
`app/api/public/outside-dealer-offer/[token]/route.ts:9` imports and uses
`limitGeneral, clientIpKey`. CSRF is intentionally skipped for `/api/public/*`
(`proxy.ts:246-248`). Upload ceiling is `MAX_DOC_COUNT 5 × MAX_DOC_BYTES 20 MB` = **100 MB per
request**, unthrottled (`:15-16`, `:197`).

---

## 8. Q7 — Isolation

**This section is largely good news.** I read every handler under `app/api/dealer/inventory/**`
and `app/api/dealer/offers/**` plus the auction, deals, leads and analytics handlers, checking the
`WHERE` clause of the query itself rather than the auth call at the top:

| Handler | `dealerId` on the query itself? |
| --- | --- |
| `GET /api/dealer/inventory` | ✅ `where: { dealerId: dealer.id }` (`route.ts:16`) |
| `POST /api/dealer/inventory` | ✅ sets `dealerId: dealer.id` (`:60`); dup check scoped (`:50`) |
| `GET /api/dealer/inventory/[id]` | ✅ `findFirst({ id, dealerId })` (`[id]/route.ts:14`) |
| `PATCH /api/dealer/inventory/[id]` | ⚠️ ownership via `findFirst({ id, dealerId })` at `:26`, then `update({ where: { id } })` at `:28` — check-then-write, not scoped on the write |
| `DELETE /api/dealer/inventory/[id]` | ✅ `updateMany({ where: { id, dealerId } })` (`:53-56`) |
| `GET /api/dealer/inventory/[id]/analytics` | ✅ `findFirst({ id, dealerId })` (`:11`) |
| `POST /api/dealer/inventory/bulk` | ✅ dup check `:166`, create `dealerId` `:183` |
| `POST …/column-mapping` | ✅ `dealerId` baked into every row (`:94`, `:149`) |
| `GET /api/dealer/offers` | ✅ both queries scoped (`route.ts:24`, `:31`) |
| `POST /api/dealer/offers` | ✅ `submitOffer({…, dealerId: dealer.id})` (`:47`), membership enforced in-txn |
| `GET /api/dealer/offers/[offerId]` | ✅ `findFirst({ id: offerId, dealerId })` |
| `PATCH …/revise` | ✅ `reviseOffer(offerId, dealer.id, …)` → `findFirst({ id, dealerId, status })` (`offer.service.ts:254`) |
| `GET /api/dealer/auctions/[auctionId]` | ✅ invitation membership first (`:21-32`); own offer only (`:84-85`) |
| `GET /api/dealer/deals/[dealId]/contract` | ✅ `findFirst({ id: dealId, offer: { dealerId } })` (`:22-23`) |
| `GET /api/dealer/leads` | ✅ `findMany({ where: { dealerId: dealer.id } })` (`:12-13`) |

Buyer PII is handled deliberately on the audited auction route: `:35-67` selects no buyer
relation, and `:72-80` **coarsens** the approved budget into a bucket with the comment *"Never
return the exact `maxOtdAmountCents` to a dealer."*

Three real exposures were found — all on **server-rendered pages that bypass the API routes'
guards**, which is exactly why an audit must not stop at the API layer:

1. **Insights page omits the anonymity guard its API enforces.** The API sets
   `const MIN_MEDIAN_SAMPLE = 4` and only emits a median at or above it
   (`app/api/dealer/auctions/[auctionId]/insights/route.ts:39-41`). The page computes the same
   median with **no minimum sample** — `allSubmittedOffers.length > 0` (`page.tsx:50-55`) — and
   then prints the percentage delta at `:67-68`. With two offers, the "anonymized segment median"
   *is* the competitor's exact OTD, and the delta makes it recoverable. The page's own copy at
   `:110` and `:134` states "Competitor offer amounts are never revealed."
2. **Opportunities page prints the buyer's exact budget.** `app/dealer/opportunities/page.tsx:50`
   selects `maxBudgetCents` and `:82-83` renders `Budget: up to $X` — the buyer's exact stated
   maximum, next to a Submit Offer button, defeating the coarsening the auction API performs.
3. **SSRF via dealer contract registration.** `app/api/dealer/contracts/upload/route.ts:6` accepts
   `documentUrl: z.string().url()` from the dealer. Deal ownership *is* verified
   (`dealer-contract.service.ts:22-26`, `DealOwnershipError`). But the URL flows to
   `scanContractVersion` → `extractContractText(cv.documentUrl)` →
   `lib/services/contract-shield/extract-text.ts:17-21`, which does a bare
   `fetch(documentUrl)` for any `http(s)` URL with **no allowlist, no host/IP validation, no
   redirect limit**. Blind SSRF from an authenticated dealer; bytes go to a PDF parser so direct
   exfiltration is limited, but internal-service probing and an error oracle are available.

**RLS is not a second line of defense.** Enabled everywhere, policies almost nowhere:

```sql
SELECT c.relname, c.relrowsecurity,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename=c.relname) policies
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname IN (…);
```
| table | rls_enabled | policies |
|---|---|---|
| inventory_items, offers, auctions, auction_invitations, deals, deposits, vehicle_requests | true | **0** |
| dealers, vehicle_offers, dealer_offer_submissions | true | 1 |

RLS-on-with-no-policy denies PostgREST/anon access (good), but Prisma connects with a role that
bypasses RLS, so it contributes **zero per-tenant isolation** to the application path. Application
scoping is the only isolation that exists — which, per the table above, is mostly solid.

---

## 9. Q8 — Stuck states

| Scenario | Finding |
| --- | --- |
| **Interrupted feed import** | `InventorySyncRun` is written only on completion (`orchestrator.ts:282`), so an interrupted run leaves committed `inventory_items` rows with **zero accounting**. There is no non-terminal state and therefore no reaper. Currently benign — all 108 production runs completed (`completed_at IS NULL` count = 0) — but the exposure is real. |
| **Interrupted dealer CSV import** | No batch record is written at all (§2.7), so partial imports are entirely untraceable. |
| **Partially written offer (auction stack)** | **Sound.** Single `Serializable` transaction covers offer + invitation update (`offer.service.ts:87-133`); side effects are outside and best-effort. |
| **Partially written offer (concierge stack)** | Five sequential unwrapped writes at `app/api/public/dealer-offer/[token]/route.ts:179-243` — submission, then document uploads, then invite status. An interruption loses documents and leaves the invite un-marked. |
| **Auction closes mid-submission** | `closeExpiredAuctions` (`auction.service.ts:219-226`) is a plain READ COMMITTED `updateMany`; the submitter re-reads auction status *inside* its Serializable transaction (`offer.service.ts:93-95`). A submission that commits just after the close is accepted into a CLOSED auction; `processAuctionClose` has already stamped `postCloseProcessedAt`, and the reconciler's query (`app/api/cron/auction-close/route.ts:33-38`) selects only `postCloseProcessedAt: null`, so that offer is never ranked. |
| **Invitation whose auction closed** | `auction_invitations` has **no status column** — physically `id, auction_id, dealer_id, invitation_score, sent_at, viewed_at, responded_at`. Every invitation is permanently non-terminal. |
| **Dealer capacity counter** | `releaseAuctionLoad` (`dealer-invitation.service.ts:338-350`) decrements with **no floor and no idempotency guard**, while `app/api/admin/auctions/[auctionId]/action/route.ts:115` creates invitations without incrementing. Production: Athelus Motors `current_auction_load = **-4**`. Since scoring does `score -= load × 5` (`:60`), a negative load *inflates* the score and the `>= 5` capacity cut can never fire. |
| **DLQ** | `lib/jobs/idempotency.ts:124-138` has exactly one caller — the Stripe webhook. Nothing on the import, offer, or auction paths ever enqueues, so `dlq-drain` cannot recover any failure in this chain. |
| **Retry / idempotency** | Re-POSTing an auction-stack offer is correctly rejected. Re-POSTing a concierge submission creates a duplicate (no `invite.status` check, §7). Re-running an import is VIN-idempotent for valid VINs only. |

---

## 10. Confirmed problems

Ordered by severity. Every entry here was verified by me in this session.

### P0 — security / data integrity

**1. 95 stale, unowned scraped listings are presented to buyers as dealer-verified**
Location: `app/api/cron/inventory-stale-sweep/route.ts:28,43` + `orchestrator.ts:263` (LANE_1
exemption) · `app/api/admin/inventory/bulk-lane/route.ts:47-61` (the promotion) ·
`app/(public)/inventory/page.tsx:38,56,77` and `app/buyer/inventory/[vehicleId]/page.tsx:32`
(the badge and the query)
Root cause: an admin bulk lane move on 2026-06-23 promoted 86 externally scraped rows (no
`dealer_id`, no `source_adapter`) to LANE_1. LANE_1 is both the "Verified — directly from a
verified AutoLenis dealer partner" badge *and* the lane the stale sweep never touches. The public
browse query filters on `isActive` only.
Impact: buyers see 95 vehicles last seen 2026-06-18 (71 days) advertised as live, dealer-verified
inventory. Consumer-trust and accuracy exposure on the public site.
Recommended fix: gate the public browse on `executableSupplyWhere()` (or at minimum on freshness);
decouple the "verified dealer" badge from the lane enum and drive it from `dealerId != null`;
require a `dealerId` before any row may be moved to LANE_1.

**2. Admin `launch-auction` mints the PAID deposit it is gated on**
Location: `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:134-144`, guard at `:3` /
`getAdminFromRequest`
Root cause: when no unlinked PAID deposit exists, the route creates one with `status: "PAID"` and
no Stripe artifact, then launches the auction and invites dealers. No role restriction.
Impact: `Deposit.status = PAID` is not evidence of payment. 3 of 8 production PAID deposits have
neither a PaymentIntent nor a Session. Revenue reporting, refund policy and the "deposit-gated"
invariant all rest on a field any admin can fabricate. Downstream, the affected buyer can never
actually pay (`app/api/buyer/deposit/create-intent/route.ts:85-91` rejects with `ALREADY_PAID`).
Recommended fix: never create a PAID deposit implicitly. Require an explicit, role-restricted
override with a distinct provenance marker (e.g. `stripePaymentIntentId = null` plus an
`overrideBy` column), exclude such deposits from revenue reporting, and surface them in the
ledger-integrity reconciliation instead of hiding them.

**3. Server-side request forgery via dealer contract registration**
Location: `app/api/dealer/contracts/upload/route.ts:6` → `dealer-contract.service.ts:29,79` →
`lib/services/contract-shield/extract-text.ts:17-21`
Root cause: `documentUrl` is accepted as any `z.string().url()` and reaches a bare
`fetch(documentUrl)` with no scheme allowlist, host/IP validation, or redirect cap. Deal ownership
is checked; the URL is not.
Impact: an authenticated dealer can drive server-side requests to arbitrary hosts, including
internal/metadata addresses. Response bytes go to a PDF parser, so this is blind SSRF plus an
error-message oracle rather than direct exfiltration.
Recommended fix: stop accepting a URL. Derive `documentUrl` server-side from the storage path
produced by `upload-file`, and in `loadContractPdfBytes` restrict the `http(s)` branch to a
configured storage host allowlist.

### P1 — inventory / matching / auction / offer blockers

**4. Inventory never influences dealer selection, while three UI surfaces claim it does**
Location: `lib/services/auction/dealer-invitation.service.ts:213-216` (the query) and `:42-77`
(scoring) · claims at `app/dealer/auctions/invited/page.tsx:53`,
`app/dealer/opportunities/page.tsx:188`, `app/dealer/auctions/page.tsx:229`
Root cause: dealer selection reads `Dealer` only — status, geo, tier, load, scorecard, preferred
makes. The request↔inventory matcher exists but its outputs (`VehicleRequestMatchResult`,
`VehicleMatchScore`) have **no reader anywhere in the codebase**.
Impact: the core marketplace premise — matching a buyer's request to dealers who have the car —
is not implemented. Dealers are told their inventory drives invitations; it does not.
Recommended fix: decide the intended design first. Either consume `VehicleRequestMatchResult` in
`inviteDealersToAuction` as a ranking input (additive, low risk), or correct the three UI strings.
Do not ship the current combination.

**5. Executable supply is zero, so every request matches nothing**
Location: `lib/services/inventory/inventory-eligibility.ts:40` (provenance clause) ↔
`inventory_items` (206 rows)
Root cause: the provenance gate was introduced without backfilling existing rows. All 206 rows
have `dealer_id`, `source_adapter` and `added_by_admin_id` NULL, so all 206 fail the gate.
Impact: `inventory-match-refresh` returns `noSupply` for 100% of requests. Verified: SQL
equivalent of `executableSupplyWhere()` returns 0.
Recommended fix: backfill `source_adapter = 'marketcheck'` for the 205 rows carrying
`external_listing_url` (their provenance is recoverable from the data), and add a startup or cron
assertion that alerts when executable supply is 0 while `inventory_items` is non-empty.

**6. Manual "Add Vehicle" can never persist a row**
Location: `app/dealer/inventory/add/page.tsx:8,26,67,69` → `app/api/dealer/inventory/route.ts:22-34,42-44`
Root cause: the form's `condition` vocabulary (`Excellent/Good/Fair/Poor`) does not intersect the
route's `z.enum(["NEW","USED","CPO"])`, and the form sends `description`, which a `.strict()`
schema rejects.
Impact: every submission returns 422. Confirmed by reproduction and by
`source_adapter='dealer_manual'` = 0 rows in production.
Recommended fix: align the form vocabulary to the enum (or map it), and either add `description`
to the schema or stop sending it. Add a route test that posts the exact body the form builds.

**7. Mapped-CSV import is permanently unreachable (cookie path mismatch)**
Location: `app/api/dealer/inventory/column-mapping/route.ts:195-201` →
`app/api/dealer/inventory/bulk/route.ts:41-42,136-142`
Root cause: cookie written with `path: "/dealer"`; consumer lives at `/api/dealer/inventory/bulk`,
which is not a path-match, so the cookie is never sent.
Impact: any CSV with non-standard headers returns `MAPPING_REQUIRED` 409 forever, and the UI loops
the dealer back to the mapping page that cannot help.
Recommended fix: set `path: "/"` (or `/api/dealer`), or better, persist the mapping server-side on
the dealer record rather than in a cookie.

**8. Bulk CSV stores prices at 1/100 of value for whole-dollar amounts ≥ $10,000**
Location: `app/dealer/inventory/bulk-upload/page.tsx:27-34` (heuristic), preview at `:253`,
persisted via `app/api/dealer/inventory/bulk/route.ts:181-199`
Root cause: a "is this already cents?" heuristic keyed on magnitude and on `.includes(".")` tested
against the *raw* string (so `$25,000` misses). The raw-rows server path always multiplies by 100,
so the two CSV paths disagree by 100×.
Impact: a $25,000 vehicle is stored as $250 while the preview shows $25,000. Such a row would win
every best-price ranking. This is the only currently-working dealer ingestion path.
Recommended fix: delete the heuristic; parse as dollars and multiply by 100 unconditionally,
matching `applyRawRows`. Require an explicit `price_cents` header for cent-denominated files.

**9. The only offer-submission UI crashes on load**
Location: `app/dealer/quick-offer/[auctionId]/page.tsx:24,176` vs
`app/api/dealer/auctions/[auctionId]/route.ts:113,117`
Root cause: the API destructures `_count` out and re-emits it as `offerCount`; the page still
reads `auctionCtx._count.offers`, dereferencing `undefined`.
Impact: `page.tsx:118` is the sole caller of `POST /api/dealer/offers` in the codebase. No dealer
can reach the submit action through the UI. Consistent with `offers` = 0 rows against 6
invitations.
Recommended fix: read `auctionCtx.offerCount` and update the interface at `:24`. Add a smoke test
that renders quick-offer against the real API response shape.

**10. A paying buyer's auction closed with zero dealers because the buyer had no location**
Location: `lib/services/auction/dealer-invitation.service.ts:199-210` (fail-closed) →
`lib/services/auction/deposit-activation.service.ts:228-243` (converge to closed)
Root cause: buyer `6cc7bfa6` has `zip`, `city` and `state` all NULL, so `buyerCoords` is null and
the invite function returns 0 by design. After the 120-minute grace
(`NO_DEALER_CLOSE_GRACE_MINUTES`, `:56`) the reconciler closed the auction and retained the $99.
Impact: proven end to end in production — deposit `b22c5013` PAID 2026-08-27 18:41 → auction
`dc009660` created 19:35 with **0 invitations** → closed 21:35 → ops alert
*"Stranded $99 deposit — no dealers"* in `notifications` at 21:35:30.405. **6 of 15 buyers (40%)
have no zip and no city/state**, so this is systemic, not a one-off.
Recommended fix: make buyer location required before deposit checkout, and fail the *checkout*
rather than the invitation when it is missing. Persist dealer coordinates (see 11) so the ladder
does not depend on a single cache row.

**11. `geocode-backfill` is not scheduled and has never run**
Location: `app/api/cron/geocode-backfill/route.ts:13` (exports GET); `vercel.json` contains no
entry (`grep -c` → 0); `cron_job_logs` has **0 rows** for it.
Root cause: the cron was written but never registered.
Impact: no dealer's `latitude`/`longitude` is ever persisted. Both production dealers have NULL
coordinates, so all dealer selection depends on the `geocoding:zip:75035` `SearchCache` row, which
expires 2026-11-21. On expiry with no Google key, `pickNearbyDealers` excludes both dealers and
**every** auction invites zero dealers.
Recommended fix: register the cron in `vercel.json`; backfill the two existing dealers now.

**12. External feed silently overwrites dealer-owned listings**
Location: `lib/services/inventory/orchestrator.ts:196-229`
Root cause: `upsert({ where: { vin }, update: { …, lane, sourceAdapter, priceCents, images } })`
keyed on the global VIN unique with no `dealerId` guard.
Impact: a dealer's LANE_1 / `dealer_manual` listing whose VIN appears in a MarketCheck response is
demoted to LANE_2/3 with the scraped price and external provenance, while `dealerId` survives —
leaving a self-contradictory row. Latent today (ingestion is 429-blocked), live the moment
MarketCheck recovers.
Recommended fix: never overwrite a row with `dealerId != null` from an external adapter; treat
dealer-owned VINs as authoritative and record the external observation separately.

**13. Post-auction insights page leaks a competitor's exact price**
Location: `app/dealer/auctions/[auctionId]/insights/page.tsx:50-55,67-68` vs
`app/api/dealer/auctions/[auctionId]/insights/route.ts:39-41`
Root cause: the API's `MIN_MEDIAN_SAMPLE = 4` guard is absent from the server-rendered page, which
computes a median whenever any offer exists.
Impact: with two offers the "anonymized median" is the competitor's exact OTD, and the printed
percentage delta makes it recoverable — while the same page asserts at `:110`/`:134` that
competitor amounts are never revealed.
Recommended fix: extract the guard into one shared function used by both the page and the route.

**14. Opportunities feed shows the buyer's exact maximum budget**
Location: `app/dealer/opportunities/page.tsx:50,82-83` vs the coarsening at
`app/api/dealer/auctions/[auctionId]/route.ts:72-80`
Root cause: the page selects and renders `VehicleRequest.maxBudgetCents` directly.
Impact: dealers see the buyer's exact ceiling next to a Submit Offer button, defeating the
anonymization the auction API deliberately performs and structurally weakening the reverse auction.
Recommended fix: route this through `bucketBudgetCents` like the auction detail API.

**15. Offer accepted into an already-reconciled auction is never ranked**
Location: `lib/services/auction/auction.service.ts:219-226` (READ COMMITTED `updateMany`) vs
`lib/services/offer/offer.service.ts:87-133` (Serializable submit) vs
`app/api/cron/auction-close/route.ts:33-38` (reconciler selects `postCloseProcessedAt: null`)
Root cause: the closer does not participate in the submitter's transaction, and post-close
processing is claimed once and never revisited.
Impact: a narrow race in which a valid offer commits and is then permanently invisible to ranking
and to the buyer.
Recommended fix: take a row lock on the auction in `closeExpiredAuctions` (as
`commitOfferSelection` already does at `select-offer.service.ts:43`), or have the reconciler
re-check for offers created after `postCloseProcessedAt`.

### P2 — reliability / UX

| # | Location | Problem | Fix |
| --- | --- | --- | --- |
| 16 | `dealer-invitation.service.ts:338-350`; `app/api/admin/auctions/[auctionId]/action/route.ts:115` | `releaseAuctionLoad` decrements with no floor or idempotency while admin single-invite never increments → `current_auction_load = -4` in production, inflating scores and disabling the `>= 5` cap | Clamp at 0; make release idempotent (or derive load from a live count) |
| 17 | `app/api/dealer/inventory/bulk/route.ts:23`, `column-mapping/route.ts:66` vs `route.ts:28-30` | Three different VIN rules feeding one globally-unique column; bulk paths neither normalize case nor check the VIN alphabet | Share `normalizeVin`+`isValidVin` across all three |
| 18 | `inventory_items_vin_key` (global UNIQUE); `bulk/route.ts:198` | Cross-dealer VIN collision silently drops rows via `skipDuplicates` and counts them as "skipped" | Report collisions explicitly; consider `(dealer_id, vin)` uniqueness for dealer-owned rows |
| 19 | `app/api/public/dealer-offer/[token]/route.ts:179` (no `invite.status` check), `:15-16,197` (100 MB), no rate limiter | Token replay creates unlimited submissions; sibling `outside-dealer-offer/[token]/route.ts:9` *does* rate-limit | Check and advance `invite.status`; add `limitGeneral` |
| 20 | `app/api/dealer/offers/route.ts:30-34`; row `903ff2b6` | Concierge submission's `dealer_id` never backfilled, so the dealer cannot see their own offer | Backfill on invite acceptance by matching the invite email to the dealer user |
| 21 | `lib/services/inventory/orchestrator.ts:282`; `app/api/admin/inventory/bulk-upload/route.ts:126` | Run/batch records written only on completion — interrupted imports leave rows with no accounting and no reaper is possible | Write a `RUNNING` row up front; add a reaper |
| 22 | `prisma/schema.prisma` `AuctionInvitation` + physical table | No status column — invitations are permanently non-terminal after their auction closes | Add a status enum, or derive terminal state from the auction |
| 23 | `app/dealer/inventory/import-history/page.tsx:6-21`; `bulk/route.ts:210-218` | Dealer imports write no batch record; history is a hardcoded empty state | Write `InventoryUploadBatch` from the dealer path and query it |
| 24 | `lib/jobs/idempotency.ts:124-138` (sole caller: Stripe webhook) | Nothing on import/offer/auction paths enqueues to the DLQ | Enqueue on the concierge submission and import paths |

### P3 — maintainability

| # | Location | Problem |
| --- | --- | --- |
| 25 | `app/api/dealer/inventory/[id]/route.ts:26-28` | PATCH is findFirst-then-update-by-id rather than `dealerId` in the update's own WHERE. Not exploitable (the check precedes), but it is the one query in the audited set not scoped on the write |
| 26 | `app/api/dealer/inventory/[id]/route.ts:39-49` | The `auctionVehicle` reservation check is not dealer-scoped — a narrow existence oracle for another dealer's item id (fails closed, so it only ever refuses) |
| 27 | `inventory-quality.service.ts:4`; `inventory-match.service.ts:23,82` | `computeQualityScore`, `findMatchedVehicles`, `saveVehiclePreferences` have zero callers; `InventoryFeedLog` and `InventoryPriceAlert` have no writer at all. Five tables permanently empty |
| 28 | `lib/services/inventory/orchestrator.ts:76` | `assignLane` tests `dealerName.includes(externalName)` — inverted and substring-based, so a short external name matches unrelated AutoLenis dealers |
| 29 | `cron/inventory-stale-sweep/route.ts:21`, `orchestrator.ts:261`, `inventory-eligibility.ts:23` | The 48-hour threshold is a bare literal in three places; the named constant is used only in its own module |
| 30 | `cron/inventory-stale-sweep/route.ts:110` | Stale-listing emails link to `/dealer/inventory/feed`, which does not exist (the page is `/dealer/inventory/feed-setup`) |
| 31 | `lib/services/offer/offer-revision.service.ts:11` vs `offer.service.ts:256` | Two different revision caps (`version >= 2` vs `MAX_OFFER_REVISIONS + 1`) |
| 32 | `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:165-172` | Admin-created invitations never set `invitation_score` — 4 of 6 production rows are NULL, silently degrading any analytics over that column |

### Sections with no material findings

- **Offer-service concurrency (auction stack).** `submitOffer`, `reviseOffer` and
  `commitOfferSelection` are all properly transactional with correct isolation and a row lock
  where one is needed. Aside from finding 15's narrow close race, no defect.
- **Buyer offer selection → Deal.** `app/api/buyer/auctions/[auctionId]/select-offer/route.ts:30,67-70`
  scopes the auction by `buyerId` and the offer by `{ id, auctionId, status: SUBMITTED }`;
  `select-offer.service.ts:41-62` takes `FOR UPDATE` on the auction row and re-checks the
  invariant under the lock. Correct.
- **Pre-deposit paid contact acquisition.** No per-request paid reveal is triggered by an unpaid
  buyer request (§6).
- **`auction-close` reporting `closed: 0, processed: 0`.** Correct, not broken: no auction is
  ACTIVE past `endsAt`, and all 7 CLOSED auctions have `post_close_processed_at` set.

---

## 11. Not verified — do not action without checking

The workflow's adversarial-verification stage did not run (§0). These tracer claims are recorded
because they are plausible and worth checking, but I did **not** confirm them:

- `custom.adapter.ts` never instantiated; `ADAPTERS = [new MarketCheckAdapter()]` — plausible but
  the exact line was not read by me.
- Column-mapping page maps six hardcoded fake column names (`DETECTED_COLUMNS`) instead of the
  dealer's real CSV headers.
- The dealer document download link points at a bare private-bucket path, so no uploaded document
  can be retrieved.
- `POST /api/admin/deals` binds a Deal to an offer without verifying the offer's auction belongs
  to the buyer, and is non-transactional.
- The legacy `Notification`-based "Vehicle Request:" stack runs in parallel to `VehicleRequest`,
  and admin *Send to Dealers* writes status back to the legacy row rather than the canonical one.
- `VehicleRequestOffer` is unreachable because its due-diligence gate requires checkpoints nothing
  creates.
- `resolveDepositFulfillmentTrack` classifies NULL-PaymentIntent deposits as `standard`.
- 1,291 duplicate `SYSTEM_ALERT` rows from the DEFERRED sync path.
- Quick-offer double-counts fees, so any offer with a fee fails the OTD assertion. (Moot while
  finding 9 stands, but relevant once it is fixed.)
- Naive CSV parsing splits on every comma, shifting columns for quoted fields.

**Two tracer claims I checked and am correcting:**

1. The public dealer-offer endpoint was reported as **"unauthenticated"** and P0. It is
   **token-authenticated** (`route.ts:110-124` returns 404 without a valid token). The real,
   verified defects are the missing rate limiter, the missing `invite.status` replay check, and
   the 100 MB upload ceiling — recorded as **P2 finding 19**, not P0.
2. `auction-close` reporting `closed: 0 / processed: 0` was read by one tracer as a live failure.
   It is correct behaviour for the current data (no ACTIVE auction past `endsAt`; all CLOSED
   auctions already post-processed).

Also genuinely unverifiable in this session: **cross-dealer isolation has never been exercised in
production** — there is only one dealer with any activity, so the isolation conclusions in §8 rest
on code reading alone, not on observed behaviour.

---

## 12. Verdict

> **Can a dealer today get real inventory into the system, have it matched to a paid buyer
> request, receive an invitation, and submit an offer?**

# No.

Four independent blockers sit on that path. Any **one** of them alone is fatal; all four are
present simultaneously.

**The step that breaks first is inventory entry itself.** Of the four dealer write paths:

- manual add returns 422 on every submission (finding 6),
- the edit page fetches `/api/dealer/inventory/undefined` and, even fixed, discards most fields (§2.2),
- mapped-CSV import returns 409 forever because of the cookie path (finding 7),
- and the one surviving path — standard-header CSV — stores any whole-dollar price ≥ $10,000 at
  1/100 of its value (finding 8).

So a dealer *can* get rows in, but only by uploading a CSV with standard headers and decimal-formatted
prices. Production confirms none has ever managed it: `source_adapter IN ('dealer_manual','dealer_csv')`
→ **0 rows**, and both ACTIVE dealers own **0** inventory items.

**Even with inventory in, the remaining three blockers still stand:**

2. **Matching never consults inventory.** `dealer-invitation.service.ts:213-216` selects dealers on
   status, geography, tier and capacity only. The request↔inventory matcher writes
   `VehicleRequestMatchResult` rows that **nothing in the codebase reads**. Separately, executable
   supply is currently 0 because all 206 rows fail the provenance gate.
3. **Invitations are geographically fragile and already failing.** The most recent paying buyer
   received **zero** invitations because they had no ZIP, city or state; the auction auto-closed
   and the $99 was retained, with the stranded-deposit alert sitting in `notifications`. 40% of
   buyers have the same missing location. Both dealers have NULL coordinates and the backfill cron
   has never been scheduled.
4. **The one offer-submission UI crashes on load.** `quick-offer/[auctionId]/page.tsx:176`
   dereferences `_count` on a response that only contains `offerCount`. It is the sole caller of
   `POST /api/dealer/offers` anywhere in the app.

The underlying service layer is, notably, **not** the problem. `submitOffer`, `reviseOffer` and
`commitOfferSelection` are well-built — correct transactions, correct isolation, a real row lock,
genuine dealer scoping on essentially every query in `app/api/dealer/**`. The failures are
concentrated in the seams: form-to-schema contracts, page-to-API response shapes, a cookie path, a
provenance gate shipped without a backfill, and a matching engine wired to nothing.

Production has never completed one cycle. Six invitations issued; **zero viewed, zero responded**
(`viewed_at` and `responded_at` are NULL on all six). Zero rows in `offers`, ever. Zero deals. The
only two real dealer offers in the platform's history arrived through the admin-driven concierge
token flow, which bypasses the dealer portal entirely — and one of those has a NULL `dealer_id`, so
the dealer who submitted it cannot see it in their own portal.
