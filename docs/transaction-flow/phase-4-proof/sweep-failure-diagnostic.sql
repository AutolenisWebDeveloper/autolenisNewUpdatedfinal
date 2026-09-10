-- PHASE 4 — the live sweep failure, narrowed from the record rather than guessed.
--
-- READ-ONLY. Operation class 3 of the per-run protocol:
--
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f sweep-failure-diagnostic.sql
--
-- ── WHAT IS KNOWN, AND WHAT IS NOT ──────────────────────────────────────────────────────
--
-- Owner census, 2026-09-10: last_run_status FAILED, vehicles_last_count 0, last_run_at
-- 2026-09-10T08:00:07, calls_used_this_cycle 9 of 400.
--
-- `calls_used_this_cycle` is a MONTH-TO-DATE counter, not a per-run one. It is keyed by
-- `budget_cycle_key` ('YYYY-MM', roll-forward only) and incremented once per provider call
-- (inventory-call-budget.service.ts:114). `inventory-sync-full` is the only scheduled
-- MarketCheck spender and runs once a day at 08:00 UTC, so by 2026-09-10 it has had ten
-- opportunities to spend. Nine calls across ten runs is therefore ~one call per run, not one
-- run of nine — but "therefore" is doing too much work there, and query 3 settles it from
-- `inventory_sync_runs.api_calls_used` instead of from arithmetic.
--
-- ── WHAT `FAILED` ALREADY RULES OUT UNDER THE DEPLOYED CODE ─────────────────────────────
--
-- `inventory_sources.last_run_status` is written from the adapter outcome AFTER classifyYield
-- (orchestrator.ts:553), so FAILED is reachable two ways, and only two:
--
--   (a) a hard adapter failure — a non-transient HTTP status on page 0; or
--   (b) a yield downgrade — which needs either a known num_found (coverage gate) or at least
--       25 raw listings (normalization gate). A run that fetched nothing reaches neither.
--
-- The deployed adapter treats EVERY 422 as `NUM_FOUND_REACHED` and breaks the walk with no
-- error recorded (origin/main marketcheck.adapter.ts:226). A 422 on page 0 therefore lands
-- ZERO_RESULTS, not FAILED. So if `api_calls_used = 1` and `status = FAILED`, the failure is
-- NOT a 422 of any kind: it is a non-transient, non-422 HTTP status — 400, 401, 403 or 404 —
-- and query 2's `error` column names it verbatim, because that path DOES record one
-- ("MarketCheck HTTP <status> on page <n> (start=<n>)").
--
-- Which is worth stating plainly: the Phase 4 fix makes the three 422 classes distinguishable
-- from each other FROM NOW ON, and it is what would tell a bad ZIP from a pagination cap from
-- a radius overrun. It does not diagnose this failure retroactively, and the evidence above
-- points away from a 422 being what is happening. Query 2 is what decides it.
--
-- ── READING THE OUTPUT ──────────────────────────────────────────────────────────────────
--
--   status   calls  error                                       what it is
--   ------------------------------------------------------------------------------------
--   FAILED     1    MarketCheck HTTP 401 on page 0 (start=0)    credential rejected
--   FAILED     1    MarketCheck HTTP 403 on page 0 (start=0)    plan/entitlement refusal
--   FAILED     1    MarketCheck HTTP 400 on page 0 (start=0)    malformed query
--   FAILED     1    MarketCheck HTTP 404 on page 0 (start=0)    endpoint moved
--   FAILED    >=2   short run: received N of M expected         coverage downgrade
--   FAILED    >=2   normalization dropped N of M listings       response shape changed —
--                                                               the include-flag defect
--   DEFERRED   1    MarketCheck HTTP 429 on page 0 (start=0)    throttled
--   ZERO_RESULTS 1  (null)                                      a 422 swallowed as
--                                                               NUM_FOUND_REACHED — this is
--                                                               the shape the fix replaces
--   NOT_CONFIGURED 0 no market configured / source is inactive  config gap, no call made
--
-- A FAILED row whose `error` is NULL would mean neither path wrote one, which the code has no
-- branch for; report it rather than reconciling it.

\echo '=== 1. the source row: configuration and the month-to-date ledger ==='
SELECT id, type, name, is_active,
       center_zip, radius_miles, filter_make, filter_model,
       filter_year_min, filter_year_max, filter_price_max_cents,
       rows_per_call, max_calls_per_run,
       monthly_call_budget, calls_used_this_cycle, budget_cycle_key,
       last_run_status, vehicles_last_count, last_run_at
FROM inventory_sources
ORDER BY type, name;

\echo ''
\echo '=== 2. THE DISCRIMINATOR: every run this cycle, with the error verbatim ==='
SELECT r.started_at, s.name AS source, r.status,
       r.api_calls_used, r.vehicles_fetched, r.vehicles_upserted, r.health_score,
       extract(epoch FROM (r.completed_at - r.started_at))::int AS seconds,
       r.error
FROM inventory_sync_runs r
JOIN inventory_sources s ON s.id = r.source_id
WHERE r.started_at >= date_trunc('month', now())
ORDER BY r.started_at DESC
LIMIT 60;

\echo ''
\echo '=== 3. is 9 calls one run of nine, or nine runs of one? ==='
SELECT s.name AS source,
       count(*)                    AS runs_this_cycle,
       sum(r.api_calls_used)       AS calls_this_cycle,
       round(avg(r.api_calls_used), 2) AS calls_per_run,
       max(r.api_calls_used)       AS worst_run,
       sum(r.vehicles_fetched)     AS fetched_this_cycle
FROM inventory_sync_runs r
JOIN inventory_sources s ON s.id = r.source_id
WHERE r.started_at >= date_trunc('month', now())
GROUP BY s.name ORDER BY 3 DESC NULLS LAST;

\echo ''
\echo '=== 4. how long it has been failing, and with how many distinct messages ==='
SELECT s.name AS source, r.status, coalesce(r.error, '(no error recorded)') AS error,
       count(*) AS runs, min(r.started_at) AS first_seen, max(r.started_at) AS last_seen
FROM inventory_sync_runs r
JOIN inventory_sources s ON s.id = r.source_id
WHERE r.started_at >= now() - interval '45 days'
GROUP BY 1, 2, 3
ORDER BY max(r.started_at) DESC;

\echo ''
\echo '=== 5. A-3: what the cron log claimed on the same days (COMPLETED over a FAILED sweep) ==='
SELECT c.started_at::date AS day, c.cron_name, c.status AS cron_said,
       (SELECT string_agg(DISTINCT r.status::text, ',')
          FROM inventory_sync_runs r
         WHERE r.started_at::date = c.started_at::date) AS sweep_actually,
       c.error, c.duration
FROM cron_job_logs c
WHERE c.cron_name IN ('inventory-sync-full', 'inventory-stale-sweep', 'inventory-match-refresh')
  AND c.started_at >= now() - interval '45 days'
ORDER BY c.started_at DESC
LIMIT 60;

\echo ''
\echo '=== 6. did anything reach the exception register while this was happening? ==='
SELECT exception_code, status, count(*) AS items,
       min(created_at) AS first_raised, max(created_at) AS last_raised
FROM queue_items
WHERE type = 'INVENTORY_EXCEPTION' OR exception_code LIKE 'INVENTORY_%'
   OR exception_code IN ('NO_IN_RADIUS_INVENTORY', 'NO_STORED_LOCATION_ON_INVENTORY')
GROUP BY 1, 2 ORDER BY max(created_at) DESC NULLS LAST;

\echo ''
\echo '=== 7. the catalogue the failures left behind ==='
SELECT count(*)                                              AS rows,
       count(*) FILTER (WHERE is_active)                     AS active,
       max(created_at)::date                                 AS newest_created,
       max(last_seen_at)::date                               AS newest_last_seen,
       count(DISTINCT coalesce(external_dealer_state, '?'))  AS distinct_states,
       count(*) FILTER (WHERE state IS NOT NULL AND btrim(state) <> '') AS with_own_state
FROM inventory_items;
