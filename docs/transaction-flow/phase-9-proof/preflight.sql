-- Phase 9 preflight — the pickup RELEASE TOKEN (20261201000000) and the POSSESSION CONDITION
-- column (20261201000100).
--
-- CONTRACT: every row returns a `verdict` of CHECKED or BLOCK. A BLOCK stops the run. The
-- terminal row reports how many assertions ran, so a preflight that produced NO OUTPUT — the
-- silent zero-row result that looks exactly like success — is detectable by the caller: no
-- CHECKED row means the query did not run.
--
-- READ-ONLY. Run inside a server-enforced read-only transaction:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f preflight.sql
--
-- WHAT THIS PHASE IS ABOUT TO DO, and therefore what must be true first:
--
--   20261201000000_phase9_pickup_release_token
--   20261201000100_phase9_possession_condition
--     1. CREATE UNIQUE INDEX pickups_token_hash_key ON pickups (token_hash)
--     2. CREATE INDEX pickups_live_release_token_idx ON pickups (token_expires_at)
--          WHERE token_hash IS NOT NULL AND token_consumed_at IS NULL AND token_revoked_at IS NULL
--     3. UPDATE pickups SET qr_code_data = NULL, qr_code_image = NULL WHERE either IS NOT NULL
--
-- THE UNIQUE INDEX IS THE DANGEROUS HALF. `CREATE UNIQUE INDEX` on a column that already holds
-- a duplicate non-null value fails the whole migration mid-chain. `token_hash` has never had a
-- writer — `release-token.service.ts` is its first — so every row should read NULL, and NULL is
-- exempt from uniqueness anyway. Both facts are ASSERTED below rather than reasoned about,
-- because "it has never had a writer" is a claim about the code, and this file's job is to
-- check the database.
--
-- THE UPDATE IS THE IRREVERSIBLE HALF. It destroys the plaintext credential deliberately (see
-- the migration header: `qr_code_image` decodes back to the raw token, so clearing it is the
-- change, not tidying after it). Nothing here can undo it, so what this file checks is that the
-- columns still exist to be cleared and that the scale is known before the run rather than after.

\pset footer off

-- ── THE OBJECTS THE MIGRATION NEEDS ─────────────────────────────────────────

-- 1. THE FOUR TOKEN COLUMNS MUST EXIST. They arrived with the Phase 1 wave
--    (20261106000100_transaction_spine_foundation) and have never had a writer. Both index
--    statements name them; absent, the migration fails at statement 1.
SELECT 'pickups.' || expected.name || ' column' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = expected.name)
            THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = expected.name)
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (VALUES ('token_hash'), ('token_expires_at'),
               ('token_consumed_at'), ('token_revoked_at')) AS expected(name);

-- 2. THE LEGACY COLUMNS MUST STILL EXIST. Statement 3 UPDATEs them by name. If a prior run
--    already dropped them (the migration's own FOLLOW-UP block proposes exactly that), this
--    UPDATE is a 42703 and takes the whole chain down. Their presence is the precondition;
--    their contents are reported separately below.
SELECT 'pickups.' || expected.name || ' column (target of the clearing UPDATE)' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = expected.name)
            THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = expected.name)
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (VALUES ('qr_code_data'), ('qr_code_image')) AS expected(name);

-- 2b. THE POSSESSION-CONDITION COLUMN MUST NOT EXIST YET (20261201000100). `ADD COLUMN IF NOT
--     EXISTS` makes re-application a no-op, which is what makes the migration safe to retry —
--     and also what would let a column created OUT OF BAND, with a different type, survive while
--     the ledger records the migration as applied. Same reasoning as the indexes below.
SELECT 'pickups.condition_at_possession column (20261201000100 adds it)' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = 'condition_at_possession')
            THEN 'ALREADY PRESENT — created out of band?' ELSE 'absent, will be added' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = 'condition_at_possession')
            THEN 'BLOCK' ELSE 'CHECKED' END AS verdict;

-- 3. NEITHER INDEX MAY ALREADY EXIST. Both statements carry `IF NOT EXISTS`, which is what
--    makes re-application a no-op — and also what would let an index created OUT OF BAND, with
--    a different predicate, survive silently while the ledger records this migration as
--    applied. The partial index is the one that matters: a predicate that drifts from the
--    resolver's WHERE clause scans the wrong set and never says so.
SELECT 'index ' || expected.name || ' not already present' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public' AND indexname = expected.name)
            THEN 'ALREADY PRESENT' ELSE 'absent, will be created' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public' AND indexname = expected.name)
            THEN 'BLOCK' ELSE 'CHECKED' END AS verdict
  FROM (VALUES ('pickups_token_hash_key'), ('pickups_live_release_token_idx')) AS expected(name);

-- 4. NO ROW MAY ALREADY CARRY A token_hash. `release-token.service.ts` is this column's FIRST
--    writer and it ships in the same change as this migration, so every row must read NULL. A
--    non-null value means something wrote a release credential by a path nobody has reviewed —
--    which is a finding, not a precondition to work around.
SELECT 'pickups carrying a token_hash (first writer ships with this migration)' AS assertion,
       count(*)::text AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM pickups WHERE token_hash IS NOT NULL;

-- 5. AND NO TWO ROWS MAY SHARE ONE. Vacuous while assertion 4 holds, and asserted anyway: it
--    is the exact condition `CREATE UNIQUE INDEX` fails on, and a preflight that reasons "4
--    implies 5" is a preflight that checked 4. NULLs are exempt from uniqueness and are
--    excluded here for the same reason Postgres excludes them.
SELECT 'duplicate token_hash values (what CREATE UNIQUE INDEX fails on)' AS assertion,
       count(*)::text AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (SELECT token_hash FROM pickups
         WHERE token_hash IS NOT NULL GROUP BY token_hash HAVING count(*) > 1) d;

-- ── THE LEDGER ──────────────────────────────────────────────────────────────

-- 6. THE MIGRATION MUST NOT ALREADY BE APPLIED. Counted FINISHED and NOT rolled back, the way
--    migration 110's preflight was rewritten to count: a rolled-back row sitting beside a
--    success is retry history, not a fault, and must not read as applied.
--
--    THE EXPECTED SET IS DECLARED ONCE, here, and the count below is derived from it. Phase 9
--    had one migration when this file was written and has two now; the second was added by
--    editing this list and nothing else, which is the property the shape was chosen for. A
--    hand-written `= 1` beside a one-name list is
--    the same shape that let phase-8's verify.sql name two of four. `phase9-proof-sql.test.ts`
--    checks this list against the directories on disk.
WITH phase9_expected(name) AS (
  VALUES ('20261201000000_phase9_pickup_release_token'),
         ('20261201000100_phase9_possession_condition')
)
SELECT 'ledger: ' || expected.name || ' not yet applied' AS assertion,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   WHERE m.migration_name = expected.name
                     AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL) = 0
            THEN 'absent, will apply'
            ELSE 'ALREADY APPLIED' END AS detail,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   WHERE m.migration_name = expected.name
                     AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL) = 0
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM phase9_expected AS expected;

-- 7. NO MIGRATION IS STUCK. A name with no finished, non-rolled-back row means a prior deploy
--    died mid-chain, and running another on top of it is how a chain forks.
SELECT 'stuck migrations' AS assertion,
       CASE WHEN count(*) = 0 THEN 'none' ELSE string_agg(migration_name, ', ') END AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (
    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
  ) stuck;

-- 8. THE CHAIN IS WHERE THE OWNER LEFT IT. Verified against production at 20:45 UTC on
--    2026-09-16: 119 rows / 117 distinct / 0 unfinished. The repository holds 118 migration
--    directories at this commit — 117 already applied plus this phase's one — and the two
--    extra ledger ROWS are retry history, which is why every assertion above counts finished,
--    non-rolled-back rows rather than rows.
--
--    THIS BLOCKS ON A MISMATCH, DELIBERATELY. A different distinct count means the chain moved
--    between the owner's verification and this run. That may be entirely legitimate — another
--    phase landing — but it means these preconditions describe a database that no longer
--    exists, and the correct response is to re-verify and update this number, not to proceed
--    on a snapshot that has expired.
SELECT 'chain is at the verified pre-state (117 distinct applied names)' AS assertion,
       count(DISTINCT migration_name)::text || ' distinct / '
         || count(*)::text || ' rows / '
         || count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || ' rolled back' AS detail,
       CASE WHEN count(DISTINCT migration_name) FILTER (
                   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 117
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM _prisma_migrations;

-- ── THE WORLD THIS RUNS AGAINST, REPORTED ───────────────────────────────────
--
-- None of the following is a BLOCK. The migration is correct whether `pickups` holds nought
-- rows or ten thousand — its own header says so, and the empty backfill is written as though
-- it were not empty for exactly that reason. These rows exist so the scale of the irreversible
-- UPDATE is known BEFORE it runs rather than inferred from its result afterwards.

-- 9. HOW MANY CREDENTIALS THE UPDATE WILL DESTROY. Owner-verified 0 at 20:45 UTC.
SELECT 'pickups carrying plaintext the UPDATE will clear' AS assertion,
       count(*) FILTER (WHERE qr_code_data IS NOT NULL OR qr_code_image IS NOT NULL)::text
         || ' of ' || count(*)::text || ' pickups' AS detail,
       'CHECKED' AS verdict
  FROM pickups;

-- 10. AND THE SURROUNDING TRANSACTION VOLUME. Owner-verified: deals 0.
SELECT 'deals on the platform' AS assertion,
       count(*)::text AS detail,
       'CHECKED' AS verdict
  FROM deals;

-- 11. THE SCHEDULER IS HEALTHY. A cron failing while a migration lands makes the two
--     indistinguishable in the incident that follows. Owner-verified: zero failures.
SELECT 'cron failures in the last 24 hours' AS assertion,
       count(*)::text AS detail,
       'CHECKED' AS verdict
  FROM cron_job_logs
 WHERE status = 'FAILED' AND started_at > now() - interval '24 hours';

-- TERMINAL ROW. If this is absent the preflight did not run, whatever the exit code said.
SELECT 'preflight complete' AS assertion,
       '19 assertions: 15 block-capable, 3 reported' AS detail,
       'CHECKED' AS verdict;
