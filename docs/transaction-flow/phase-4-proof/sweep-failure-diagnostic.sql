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
-- ── ANSWERED, 2026-09-10, BY THE OWNER RUNNING THIS FILE ───────────────────────
--
-- Query 2 returned eight consecutive daily runs, 2026-09-03 through 2026-09-10, identical:
--
--   status FAILED · api_calls_used 1 · vehicles_fetched 0 · health 0 · seconds 0
--   error "normalization dropped 50 of 50 listings (missing year/make/model/price)"
--
-- The provider is answering and returning 50 listings per call. All 50 are unusable because
-- `normalize()` derives year/make/model from `listing.build` (marketcheck.adapter.ts:646-648)
-- and the DEPLOYED adapter never asks for it. Zero normalized, so zero fetched, so FAILED.
--
-- THE FIX IS ON THE PHASE 4 BRANCH: `include_build_object: "true"`, with its two siblings, at
-- marketcheck.adapter.ts:610. `origin/main` sends none of the three. Merging Phase 4 repairs
-- this sweep; nothing else needs to change.
--
-- ── THE INFERENCE THIS FILE MADE, AND WHY IT WAS WRONG ───────────────────────────
--
-- Kept rather than deleted, because the shape of the error is worth more than the conclusion.
--
-- `inventory_sources.last_run_status` is written from the adapter outcome AFTER classifyYield
-- (orchestrator.ts:553), so FAILED is reachable two ways, and only two:
--
--   (a) a hard adapter failure — a non-transient HTTP status on page 0; or
--   (b) a yield downgrade — which needs either a known num_found (coverage gate) or at least
--       25 raw listings (normalization gate).
--
-- That much was right. The next step was not: this file reasoned that one call could not reach
-- (b) and therefore had to be (a) — a 401, 403, 400 or 404 — and ranked a rejected credential
-- first. The step it skipped is that ONE CALL RETURNS ROWS. `rows_per_call` is 50, so a single
-- page clears NORMALIZE_MIN_RAW = 25 on its own and the normalization gate fires on call one.
-- "One call" was read as "fetched nothing" when it means "fetched one page of fifty".
--
-- The walk then STOPS at page 0 precisely because nothing normalized, so the shape is
-- permanently one call — never two or more. The table below said `>=2` for this row; that was
-- the same mistake in the other direction and is corrected.
--
-- The deployed adapter also treats EVERY 422 as `NUM_FOUND_REACHED` and breaks the walk with no
-- error recorded (origin/main marketcheck.adapter.ts:226), so a 422 on page 0 lands ZERO_RESULTS
-- rather than FAILED. That part of the ruling-out holds, and the Phase 4 fix is what makes the
-- three 422 classes — a bad ZIP, a pagination cap, a radius overrun — distinguishable from each
-- other from now on. It was never going to name THIS failure, which is not a 422.
--
-- ── READING THE OUTPUT ────────────────────────────────────────────────
--
--   status   calls  error                                       what it is
--   ------------------------------------------------------------------------------------
--   FAILED     1    normalization dropped 50 of 50 listings     THE OBSERVED FAILURE. The
--                                                               include-flag defect: the walk
--                                                               dies on page 0 because nothing
--                                                               normalized, so it is always
--                                                               exactly one call
--   FAILED     1    MarketCheck HTTP 401 on page 0 (start=0)    credential rejected
--   FAILED     1    MarketCheck HTTP 403 on page 0 (start=0)    plan/entitlement refusal
--   FAILED     1    MarketCheck HTTP 400 on page 0 (start=0)    malformed query
--   FAILED     1    MarketCheck HTTP 404 on page 0 (start=0)    endpoint moved
--   FAILED    >=1   short run: received N of M expected         coverage downgrade. One call
--                                                               when the first page is short,
--                                                               more when the walk continued
--   DEFERRED   1    MarketCheck HTTP 429 on page 0 (start=0)    throttled. 191 consecutive
--                                                               runs of this, 2026-08-24 to
--                                                               08-31 — the silent freeze,
--                                                               with its actual error
--   ZERO_RESULTS 1  (null)                                      a 422 swallowed as
--                                                               NUM_FOUND_REACHED — this is
--                                                               the shape the fix replaces
--   COMPLETED  0    (null), vehicles_fetched > 0                A DEALER JSON FEED. The work
--                                                               happened; the 0 is a false
--                                                               zero. See the note below
--   NOT_CONFIGURED 0 no market configured / source is inactive  config gap, no call made
--
-- A FAILED row whose `error` is NULL would mean neither path wrote one, which the code has no
-- branch for; report it rather than reconciling it.

-- ── THE 83 ZERO-CALL "COMPLETED" RUNS, 08-31 TO 09-02 — ANSWERED ────────────────
--
-- Owner question, 2026-09-10: "Either a cache path is writing inventory_sync_runs rows as if it
-- were a sync, or something is reporting success for work it did not do. Find out which."
--
-- NEITHER. The work happened and the vehicles are real; the zero is an accounting artefact.
--
--   * There is exactly ONE writer of `inventory_sync_runs` in the repository —
--     orchestrator.ts:529. No cache path writes this table. (`grep -rn inventorySyncRun`
--     over app/ lib/ scripts/, excluding tests, returns that one line.)
--   * It writes `apiCallsUsed: r.apiCallsUsed ?? 0` (orchestrator.ts:536), and `apiCallsUsed`
--     is OPTIONAL on the adapter contract (IInventoryAdapter.ts:113).
--   * `CustomFeedAdapter.search()` performs a real `fetch()` against the dealer feed URL
--     (custom.adapter.ts:53) and returns the parsed vehicles (custom.adapter.ts:72-79) — and
--     never sets `apiCallsUsed`. The `?? 0` turns "the adapter did not say" into a recorded 0.
--   * `MarketCheckAdapter` cannot produce this shape: both early returns that set
--     `apiCallsUsed: 0` also return `vehicles: []` (marketcheck.adapter.ts:325-331, 340-347),
--     and the path that returns vehicles reports the real count (:515).
--   * `outcomeToStatus(SUCCESS) -> COMPLETED` and the health score is 100 for any outcome that
--     is not FAILED/DEFERRED/NOT_CONFIGURED (orchestrator.ts:65, :541).
--
-- So the 83 rows are dealer JSON feed syncs that fetched and ingested 20-43 vehicles each. The
-- window fits: they sit immediately after the 191-run 429 storm ended on 08-31, when MarketCheck
-- was the source that was not producing and the feeds were.
--
-- It IS the same family as the cron log saying COMPLETED over a failed sweep — a column that
-- reads as a fact and is not one — but it under-reports work rather than over-reporting it, so
-- no run claimed a success it did not earn. REPORTED, NOT FIXED HERE, per the owner's
-- instruction. The fix is one line: have `CustomFeedAdapter` report the call it makes, so the
-- run-size anomaly and the budget alert this phase built read a true number for every source.

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
