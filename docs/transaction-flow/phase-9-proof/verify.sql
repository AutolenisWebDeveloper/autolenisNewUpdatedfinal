-- Phase 9 verify — run AFTER `prisma migrate deploy`, and report BOTH halves.
--
-- WHY BOTH. A ledger row with a missing object is a silent lie: `migrate resolve --applied`
-- writes the row without running a line of the SQL, and `CREATE INDEX IF NOT EXISTS` no-ops
-- over an object created out of band with a different definition. Half one asks the catalog
-- what physically exists; half two asks `_prisma_migrations` what Prisma believes. Neither
-- alone is sufficient, and phase 8's verify.sql shipped with half one missing entirely for the
-- two migrations added late — every row it printed was true, and it would have reported a
-- clean deploy with those migrations' objects absent.
--
-- READ-ONLY. Run inside a server-enforced read-only transaction:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f verify.sql
--
-- Every row returns PRESENT or MISSING. A MISSING row is REPORTED, never repaired with DDL:
-- the repair is a new forward migration or an owner-approved `migrate resolve`.

\pset footer off

-- ── HALF ONE: THE PHYSICAL SCHEMA ───────────────────────────────────────────

-- 1-2. BOTH INDEXES EXIST. These are the migration's only created objects.
SELECT 'index ' || expected.name AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public' AND indexname = expected.name)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the migration creates this; absent means its SQL did not run' AS remedy
  FROM (VALUES ('pickups_token_hash_key'), ('pickups_live_release_token_idx')) AS expected(name);

-- 3. THE UNIQUE INDEX IS VALID *AND* UNIQUE. Presence alone is not the check twice over: a
--    failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index that appears in pg_indexes and
--    enforces nothing, and an index by this name that is not UNIQUE enforces nothing either.
--    Single use rests entirely on this one object — without uniqueness two pickups can carry
--    the same hash and `findUnique` cannot resolve a token to one appointment.
SELECT 'pickups_token_hash_key is VALID and UNIQUE' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                          WHERE c.relname = 'pickups_token_hash_key'
                            AND i.indisvalid AND i.indisunique)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'an INVALID or non-unique index here means single use is not enforced at all' AS remedy;

-- 4. THE PARTIAL INDEX IS VALID.
SELECT 'pickups_live_release_token_idx is VALID' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                          WHERE c.relname = 'pickups_live_release_token_idx' AND i.indisvalid)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'an INVALID partial index is present in pg_indexes and scans nothing' AS remedy;

-- 5. AND ITS PREDICATE IS THE RESOLVER'S. `release-token.service.ts` resolves a live token on
--    exactly these three conditions. An index whose WHERE clause drifts from the resolver's
--    silently scans the wrong set — it does not error, it just stops being the index the query
--    planner wanted, and no test notices. Each clause is checked by name rather than by
--    matching the whole string, because Postgres re-renders the predicate with its own
--    parenthesisation and a whole-string compare would be brittle for the wrong reason.
SELECT 'pickups_live_release_token_idx predicate matches the resolver' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public'
                            AND indexname = 'pickups_live_release_token_idx'
                            AND indexdef LIKE '%token_hash IS NOT NULL%'
                            AND indexdef LIKE '%token_consumed_at IS NULL%'
                            AND indexdef LIKE '%token_revoked_at IS NULL%')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a predicate that drifts from the resolver indexes a set the scan never asks for' AS remedy;

-- 6. AND IT IS KEYED ON token_expires_at. The predicate selects live tokens; the KEY is what
--    makes an expiry sweep an index scan rather than a table scan.
SELECT 'pickups_live_release_token_idx is keyed on token_expires_at' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public'
                            AND indexname = 'pickups_live_release_token_idx'
                            AND indexdef LIKE '%(token_expires_at)%')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the partial index exists but on the wrong column' AS remedy;

-- 7. NO PLAINTEXT CREDENTIAL SURVIVES. This is the half of the migration that cannot be undone
--    and the half that actually ends the exposure. `qr_code_image` counts: it stores
--    `QRCode.toDataURL(rawPayload)` and the PNG decodes back to the same raw token, so a run
--    that cleared only `qr_code_data` would pass a narrower check while leaving a working
--    credential in the database.
SELECT 'no plaintext release credential survives in pickups' AS object,
       CASE WHEN (SELECT count(*) FROM pickups
                   WHERE qr_code_data IS NOT NULL OR qr_code_image IS NOT NULL) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a surviving qr_code_data or qr_code_image is a readable credential; hash-at-rest is not achieved' AS remedy;

-- 8. NO TWO PICKUPS SHARE A HASH. The unique index makes this impossible going forward;
--    asserting it confirms the index is doing the job rather than merely existing.
SELECT 'no duplicate token_hash values' AS object,
       CASE WHEN (SELECT count(*) FROM (
                    SELECT token_hash FROM pickups WHERE token_hash IS NOT NULL
                     GROUP BY token_hash HAVING count(*) > 1) d) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'two pickups sharing a hash means one token resolves to two appointments' AS remedy;

-- 9-12. THE FOUR COLUMNS THE INDEXES AND THE SERVICE DEPEND ON. Phase 1 created them and this
--       phase gave them their first writer. Re-asserted here because an index is verified
--       above against columns that must still exist for `release-token.service.ts` to read.
SELECT 'pickups.' || expected.name AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = expected.name)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'release-token.service.ts reads and writes this; absent means 42703 on every mint and scan' AS remedy
  FROM (VALUES ('token_hash'), ('token_expires_at'),
               ('token_consumed_at'), ('token_revoked_at')) AS expected(name);

-- 13. THE POSSESSION-CONDITION COLUMN (20261201000100). TYPE CHECKED, not merely presence: the
--     column is what stops the buyer's condition report overwriting the dealership's, and a
--     column of the wrong type would be present and useless.
SELECT 'pickups.condition_at_possession' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = 'condition_at_possession'
                            AND data_type = 'text')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'confirmPossession writes the BUYER''s condition here; absent means it falls back to ' ||
       'nothing and Stage 20''s thirteenth precondition can never be satisfied' AS remedy;

-- 14. AND THE DEALERSHIP'S COLUMN MUST STILL BE THERE. The defect 20261201000100 repairs was two
--     facts in one column; a "repair" that moved the buyer's out and dropped the dealer's would
--     pass assertion 13 and lose the Stage 18 record.
SELECT 'pickups.condition_at_release (still present after the split)' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pickups'
                            AND column_name = 'condition_at_release'
                            AND data_type = 'text')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'recordDealerRelease writes the DEALERSHIP''s condition here (Stage 18)' AS remedy;

-- ── HALF TWO: THE LEDGER ────────────────────────────────────────────────────
-- Counted FINISHED and NOT rolled back. A rolled-back row sitting beside a success is RETRY
-- HISTORY, not a fault, and must render as PRESENT rather than MISSING — production reads 119
-- rows against 117 distinct names for exactly that reason.

-- THE EXPECTED SET, DECLARED ONCE, and the count below derived from it rather than restated as
-- a literal. Phase 9 ships one migration; a `= 1` written beside a one-name list is the same
-- shape that let phase-8's verify.sql name two migrations out of four and report a clean
-- deploy with the other two missing. `phase9-proof-sql.test.ts` checks this list against the
-- directories on disk and fails the build when a Phase 9 migration is added and this file is
-- not updated — because a list maintained by hand is how that drifted in the first place. It
-- has already earned its place: 20261201000100 was added mid-phase and this file was red until
-- the name was added here.
WITH phase9_expected(name) AS (
  VALUES ('20261201000000_phase9_pickup_release_token'),
         ('20261201000100_phase9_possession_condition')
)
SELECT 'ledger ' || expected.name AS object,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   WHERE m.migration_name = expected.name
                     AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL) = 1
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   WHERE m.migration_name = expected.name AND m.rolled_back_at IS NOT NULL) > 0
            THEN 'a rolled-back row sits beside this one: RETRY HISTORY, not a failure'
            ELSE 'no ledger row means Prisma will re-apply this on the next deploy' END AS remedy
  FROM phase9_expected AS expected;

-- Exactly ONE applied row each, and exactly as many as the phase has migrations. The count is
-- derived from the same list rather than restated.
WITH phase9_expected(name) AS (
  VALUES ('20261201000000_phase9_pickup_release_token'),
         ('20261201000100_phase9_possession_condition')
)
SELECT 'ledger has exactly one applied row per phase 9 migration' AS object,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   JOIN phase9_expected e ON e.name = m.migration_name
                   WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)
                 = (SELECT count(*) FROM phase9_expected)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'one applied row per phase 9 migration (' ||
         (SELECT count(*) FROM phase9_expected)::text ||
         ' expected); more means the SQL ran twice, fewer means one did not apply' AS remedy;

-- No migration stuck mid-chain.
SELECT 'no stuck migrations in the chain' AS object,
       CASE WHEN (SELECT count(*) FROM (
                    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
                    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
                  ) s) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a name with no finished, non-rolled-back row means a deploy died mid-chain' AS remedy;

-- TERMINAL ROW. Absent means this file did not run, whatever the exit code said. The numbers
-- are checked against the file by `phase9-proof-sql.test.ts`, which counts the rows each
-- statement emits rather than trusting this line — phase 8's equivalent went stale twice, and
-- a typed count drifting beside a hand-written list is the defect this directory is about.
SELECT 'verify complete' AS object,
       '19 assertions: 14 physical, 4 ledger.' AS status,
       'no PRESENT/MISSING row above may be MISSING' AS remedy;
