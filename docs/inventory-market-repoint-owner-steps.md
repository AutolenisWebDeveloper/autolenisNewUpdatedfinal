# Inventory market re-point — owner-gated steps

**Nothing in this file has been run.** No environment variable was set, no migration applied, no
production row written. Everything below is for you to execute when you choose.

Branch: `claude/inventory-market-repoint-s5eekb`.

---

## 0. What changes the moment this deploys — read first

| | Before | After |
| --- | --- | --- |
| MarketCheck query centre | hardcoded ZIP `10001` (Manhattan) | whatever you configure; **nothing** if you configure nothing |
| Unconfigured deployment | silently syncs New York | reports `NOT_CONFIGURED`, ingests nothing |
| `inventory-stale-sweep` | deactivates 0 rows, forever | deactivates ~**95** rows on its first real run |
| Public active catalogue | 148 | ~**53** until DFW listings land |

**The catalogue drop is the point, not a side effect.** Those 95 rows are New York listings last
seen between 27 Apr and 18 Jun, currently badged **"Verified"** and *"Directly from a verified
AutoLenis dealer partner"* to buyers, with no dealer link behind any of them. Step 4 lets you see
exactly what would go before it goes.

The sweep runs every 30 minutes, so it will fire within half an hour of deploy unless you set
`AUTOLENIS_VERIFICATION_HOOK`-style gating — there is none for crons. **Set the env vars (step 1)
in the same window as the deploy** so DFW inventory starts arriving as the New York rows leave.

---

## 1. Environment variables — Vercel → Project → Settings → Environment Variables

Scope: **Production** and **Preview**.

| Variable | Value to set | Required? |
| --- | --- | --- |
| `INVENTORY_DEFAULT_MARKET_ZIP` | `75201` (Dallas) — or `76102` for a Fort Worth centre | **Yes**, until step 3 configures the database |
| `INVENTORY_DEFAULT_RADIUS_MILES` | `75` | No — defaults to `75` |
| `INVENTORY_DEFAULT_MARKET_LABEL` | `Dallas-Fort Worth` | No — cosmetic, appears in logs and the sync-run payload |
| `MARKETCHECK_API_KEY` | *(already set — confirm it is still present)* | Yes, or the source stays `NOT_CONFIGURED` |

Notes:

* **These work before the migration.** Env is resolution layer 3; the database columns are layer 2.
  Setting `INVENTORY_DEFAULT_MARKET_ZIP` alone re-points the market with no schema change at all —
  which is why it is the first step and the migration is not urgent.
* **Do not set `INVENTORY_DEFAULT_MARKET_ZIP=10001`.** That restores Manhattan platform-wide with
  no code change and no audit record. It is the one remaining way to get New York back by accident.
* Vercel env changes need a redeploy to take effect.
* **Radius default changed 100 → 75 miles.** The old 100 only ever applied to the NYC fallback. If
  you want the previous reach, set `INVENTORY_DEFAULT_RADIUS_MILES=100`.

Redeploy, then confirm from the logs of the next `inventory-sync-priority` run (hourly, minute 0):

```
[inventory-orchestrator] MarketCheck: Dallas-Fort Worth 75201 r=75mi (env)
```

The `(env)` suffix is the resolution layer that won — it becomes `(source)` after step 3.

---

## 2. Migration — apply BEFORE or WITH the code

```bash
cd frontend && pnpm exec prisma migrate deploy
```

Applies `prisma/migrations/20261104000000_inventory_source_market_config/` — nine additive,
nullable/defaulted columns on `inventory_sources`. No DROP, no data change, no constraint, no index,
no backfill, no RLS change. Every statement is `ADD COLUMN IF NOT EXISTS`, so re-running is a no-op.

**Why before the code:** Prisma selects every column a model declares, so once `schema.prisma`
carries these fields an `inventory_sources` read fails with `P2022` against a database that lacks
them. The orchestrator detects that specific error (narrowed to `market_*` columns) and degrades to
the env fallback rather than taking inventory sync down — so deploying the code first is survivable,
but it is still the wrong order. Unread columns cost nothing.

---

## 3. Configure the market on the source row (after step 2)

This is a **data write to production**. It has not been run.

```sql
-- Point the existing MarketCheck source at Dallas-Fort Worth.
UPDATE inventory_sources
   SET market_label        = 'Dallas-Fort Worth',
       market_zip          = '75201',
       market_radius_miles = 75
 WHERE type = 'MARKETCHECK'
   AND name = 'MarketCheck';
```

Optional filters on the same row — leave NULL/empty for no filter:

```sql
UPDATE inventory_sources
   SET market_makes           = ARRAY['Toyota','Honda','Ford'],  -- empty array = all makes
       market_price_max_cents = 4500000,                          -- $45,000
       market_year_min        = 2018
 WHERE type = 'MARKETCHECK' AND name = 'MarketCheck';
```

**A second market** (you mentioned buyers in FL) is a second row, not a new table:

```sql
INSERT INTO inventory_sources (id, type, name, is_active, market_label, market_zip, market_radius_miles)
VALUES (gen_random_uuid()::text, 'MARKETCHECK', 'MarketCheck — Houston', true, 'Houston', '77002', 60);
```

Each row is queried independently and gets its own `inventory_sync_runs` record. `is_active = false`
on a row genuinely stops syncing it.

> There is **no admin UI for `inventory_sources`** — configuring a market today means SQL. That gap
> is listed in §7.

---

## 4. Preview the sweep before letting it fire

The cron accepts `?dryRun=1`, which counts what it *would* deactivate and writes nothing (no rows
touched, no dealer emails sent):

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://autolenis.com/api/cron/inventory-stale-sweep?dryRun=1" | jq
# => { "success": true, "data": { "deactivated": 95, "dryRun": true, ... } }
```

Or read the same population directly:

```sql
SELECT count(*) FROM inventory_items
 WHERE is_active
   AND dealer_id IS NULL
   AND added_by_admin_id IS NULL
   AND (last_seen_at < now() - interval '48 hours'
        OR (last_seen_at IS NULL AND created_at < now() - interval '48 hours'));
-- expect 95
```

---

## 5. Post-deploy verification

```sql
-- Columns present
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'inventory_sources' AND column_name LIKE 'market_%'
 ORDER BY column_name;   -- expect 9 rows

-- inventory_sources RLS unchanged: enabled, zero policies (deny-all + service_role bypass)
SELECT relrowsecurity FROM pg_class WHERE relname = 'inventory_sources';   -- expect true
SELECT count(*) FROM pg_policies WHERE tablename = 'inventory_sources';    -- expect 0

-- The configured market
SELECT type, name, is_active, market_label, market_zip, market_radius_miles
  FROM inventory_sources;

-- The sweep actually ran (was 0 for four months)
SELECT started_at, result->>'deactivated' AS deactivated, result->>'dryRun' AS dry_run
  FROM cron_job_logs WHERE cron_name = 'inventory-stale-sweep'
 ORDER BY started_at DESC LIMIT 5;

-- The catalogue is moving to TX
SELECT external_dealer_state, count(*) FROM inventory_items
 WHERE is_active GROUP BY 1 ORDER BY 2 DESC;

-- Newly ingested rows carry coordinates (without them the ZIP+radius filter finds nothing)
SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords, count(*) AS total
  FROM inventory_items WHERE is_active AND source_adapter = 'marketcheck';
```

---

## 6. Rollback

| Layer | Action |
| --- | --- |
| Code | Revert the branch / redeploy the previous deployment. |
| Schema | `psql -f prisma/migrations/20261104000000_inventory_source_market_config/rollback.sql` — drops the nine columns. **Roll the code back first**, or the running deployment hits the same `P2022`. |
| Market | Unset `INVENTORY_DEFAULT_MARKET_ZIP` → the source reports `NOT_CONFIGURED` and ingests nothing. It will not fall back to New York. |
| Swept rows | The sweep sets `is_active = false`; it never deletes. To restore the 95: `UPDATE inventory_items SET is_active = true, last_seen_at = now() WHERE id IN (...);` — but they are 3–5-month-old New York listings, so restoring them re-creates the original problem. |

---

## 7. Known gaps this change does NOT close

Found while tracing; each is real, none is fixed here.

1. **No admin UI for `inventory_sources`.** Market config is SQL-only (§3). `/admin/inventory/markets`
   manages a *different* model.
2. **`MarketCoverage` is decorative.** `/admin/inventory/markets` and the coverage map read a table
   nothing in the sync path writes — `listing_count` and `last_sync_at` are never populated by any
   code. After the re-point that page will still say New York while the sync queries Dallas. Do not
   trust it.
3. **Public SEO pages still promise a New York market** — `lib/seo/locations.ts` publishes
   NYC/Jersey City/Yonkers/Newark landing pages claiming "verified NYC-area dealers compete for your
   business". These are indexed public claims about a market you will no longer serve.
4. **Dealer prospecting is still NYC-anchored** — `scripts/amips-discover-dealers.ts` and
   `lib/amips/metros.ts` default to New York. Dealer supply and inventory geography will disagree.
5. **The admin search tool bypasses the adapter** — `app/api/admin/inventory/search-tool/run`
   fetches MarketCheck directly on a different host, with no market governance.
6. **`prisma/seed.ts` still creates rows with no `lastSeenAt`, no `sourceAdapter`, no `dealerId`** —
   the shape of the orphan cohort. Dev-only, but it reproduces the bug in any seeded environment.
7. **Cron hygiene in `inventory-stale-sweep`**: N+1 dealer lookups, an unbounded `findMany`, no
   `maxDuration`, `.catch(() => 1)` turning a database failure into "feed healthy", and
   `feedFailureEmails` counting attempts rather than sends. Pre-existing; safe at 221 rows, not at
   scale.
8. **No index for the new sweep predicate.** `@@index([lane, isActive])` no longer fits it. At 221
   rows this is free; revisit past ~100k rows with `@@index([isActive, lastSeenAt])`.
