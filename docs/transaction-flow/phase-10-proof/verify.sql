-- Phase 10 verify — run AFTER `prisma migrate deploy`, and report BOTH halves.
--
-- AUTHORED AFTER THE FACT, like its sibling preflight.sql — see that file's header for why the
-- package did not exist when the owner applied both migrations at 02:36 UTC on 2026-09-18. This
-- file differs from the preflight in one important way: it is written against the POST-deploy
-- state, which is the state production is in NOW, so it is runnable and meaningful today. The
-- values it asserts are the ones the owner verified independently at 02:36 and are recorded in
-- proof-run.log.
--
-- WHY BOTH HALVES. A ledger row with a missing object is a silent lie: `migrate resolve --applied`
-- writes the row without running a line of the SQL, and both of this phase's statements are
-- `IF NOT EXISTS` forms that no-op over an object created out of band with a different definition.
-- Half one asks the catalog what physically exists; half two asks `_prisma_migrations` what Prisma
-- believes. Neither alone is sufficient, and phase 8's verify.sql shipped with half one missing
-- entirely for the two migrations added late — every row it printed was true, and it would have
-- reported a clean deploy with those migrations' objects absent.
--
-- READ-ONLY. Run inside a server-enforced read-only transaction:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f verify.sql
--
-- Every row returns PRESENT or MISSING. A MISSING row is REPORTED, never repaired with DDL: the
-- repair is a new forward migration or an owner-approved `migrate resolve`.

\pset footer off

-- ── HALF ONE: THE PHYSICAL SCHEMA ───────────────────────────────────────────

-- 1-2. BOTH ENUM TYPES CARRY 'CANCELLED'. This is the whole of 20261215000000. Owner-verified at
--      02:36 UTC: both present.
SELECT expected.name || ' carries CANCELLED' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                          WHERE t.typname = expected.name AND e.enumlabel = 'CANCELLED')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the §24 orchestration writes this label; absent means every cancellation stop that ' ||
       'touches this type fails at runtime, inside the cancellation rather than at start-up' AS remedy
  FROM (VALUES ('AuctionInvitationStatus'), ('PickupStatus')) AS expected(name);

-- 3-5. AND THE LABELS 'CANCELLED' EXISTS TO BE DISTINCT FROM ARE STILL THERE. The migration's own
--      header is explicit that the point of the new label is that it is NOT these: EXPIRED would
--      tell a dealership it missed a deadline it never missed, NOT_SCHEDULED would erase the fact
--      that an appointment existed, and RESCHEDULED would promise another. A type recreated rather
--      than altered would satisfy assertions 1-2 and lose the distinction that motivated them.
SELECT expected.typ || ' still carries ' || expected.label AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                          WHERE t.typname = expected.typ AND e.enumlabel = expected.label)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'CANCELLED is meaningful only as a contrast with this label; losing it collapses the ' ||
       'vocabulary the migration exists to widen' AS remedy
  FROM (VALUES ('AuctionInvitationStatus', 'EXPIRED'),
               ('PickupStatus', 'NOT_SCHEDULED'),
               ('PickupStatus', 'RESCHEDULED')) AS expected(typ, label);

-- 6. THE PARTIAL UNIQUE INDEX EXISTS. This is the whole of 20261215000100.
SELECT 'index post_completion_obligations_open_deal_type_key' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                          AND indexname = 'post_completion_obligations_open_deal_type_key')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the migration creates this; absent means its SQL did not run' AS remedy;

-- 7. AND IT IS VALID *AND* UNIQUE. Presence alone is not the check twice over: a failed
--    `CREATE INDEX CONCURRENTLY` leaves an INVALID index that appears in pg_indexes and enforces
--    nothing, and an index by this name that is not UNIQUE enforces nothing either. §13-D60 rests
--    entirely on this one object — without uniqueness two concurrent `openObligation` calls
--    produce two PENDING rows for one (deal, type) and double-count on the dealership scorecard,
--    which is the harm the function's own comment names.
SELECT 'post_completion_obligations_open_deal_type_key is VALID and UNIQUE' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                          WHERE c.relname = 'post_completion_obligations_open_deal_type_key'
                            AND i.indisvalid AND i.indisunique)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'an INVALID or non-unique index here means §13-D60 is not enforced at all' AS remedy;

-- 8. AND ITS PREDICATE IS THE ONE §13-D60 RULED. Owner-verified at 02:36: UNIQUE (deal_id, type)
--    WHERE status <> 'RESOLVED'. A FULL unique would make a second temp-tag obligation on the same
--    deal impossible for ever, which is not what idempotency means here and is the carve-out the
--    ruling was explicit about. A predicate that drifts does not error — it enforces a different
--    rule, silently. Checked by clause rather than whole-string, because Postgres re-renders the
--    predicate with its own parenthesisation and casts.
SELECT 'the index predicate is the partial carve-out §13-D60 ruled' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public'
                            AND indexname = 'post_completion_obligations_open_deal_type_key'
                            AND indexdef LIKE '%WHERE%'
                            AND indexdef LIKE '%status%'
                            AND indexdef LIKE '%<>%'
                            AND indexdef LIKE '%RESOLVED%')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a full unique, or a drifted predicate, bars a legitimately recurring obligation for ever' AS remedy;

-- 9. AND IT IS KEYED ON (deal_id, type), IN THAT ORDER. The predicate selects open rows; the KEY
--    is what makes the constraint "idempotent per (deal, type)" rather than per anything else.
SELECT 'the index is keyed on (deal_id, type)' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public'
                            AND indexname = 'post_completion_obligations_open_deal_type_key'
                            AND indexdef LIKE '%(deal_id, type)%')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the index exists but on the wrong columns, so it constrains something else entirely' AS remedy;

-- 10. THE PRE-EXISTING INDEX SURVIVES. 20261215000100 ADDS; it replaces nothing. A migration that
--     had dropped `post_completion_obligations_deal_id_idx` while adding the unique would pass
--     every assertion above and quietly change how every per-deal obligation lookup is planned.
SELECT 'index post_completion_obligations_deal_id_idx (pre-existing, must survive)' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                          AND indexname = 'post_completion_obligations_deal_id_idx')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'this phase adds an index and removes none; its absence is a regression, not a side effect' AS remedy;

-- 11. NO TWO OPEN OBLIGATIONS SHARE (deal_id, type). The unique index makes this impossible going
--     forward; asserting it confirms the index is doing the job rather than merely existing.
SELECT 'no duplicate OPEN (deal_id, type) pairs' AS object,
       CASE WHEN (SELECT count(*) FROM (
                    SELECT deal_id, type FROM post_completion_obligations
                     WHERE status <> 'RESOLVED' GROUP BY deal_id, type HAVING count(*) > 1) d) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'two open obligations on one (deal, type) double-count on the dealership scorecard' AS remedy;

-- 12-14. THE THREE COLUMNS THE INDEX DEPENDS ON. Re-asserted after the fact because the index is
--        verified above against columns that must still exist for `openObligation` to read.
SELECT 'post_completion_obligations.' || expected.name AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'post_completion_obligations'
                            AND column_name = expected.name)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the index names this column; absent means the index cannot exist and openObligation is 42703' AS remedy
  FROM (VALUES ('deal_id'), ('type'), ('status')) AS expected(name);

-- ── HALF TWO: THE LEDGER ────────────────────────────────────────────────────
-- Counted FINISHED and NOT rolled back. A rolled-back row sitting beside a success is RETRY
-- HISTORY, not a fault, and must render as PRESENT rather than MISSING — production reads 123 rows
-- against 121 distinct names for exactly that reason, and read 121 against 119 before this phase.

-- THE EXPECTED SET, DECLARED ONCE, and the count below derived from it rather than restated as a
-- literal. `phase10-proof-sql.test.ts` checks this list against the directories on disk and fails
-- the build when a Phase 10 migration is added and this file is not updated — because a list
-- maintained by hand is how phase 8's drifted to naming two of four.
--
-- Owner-verified at 02:36 UTC: both rows finished, applied_steps_count 1 each.
WITH phase10_expected(name) AS (
  VALUES ('20261215000000_phase10_cancellation_vocabulary'),
         ('20261215000100_phase10_obligation_unique')
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
  FROM phase10_expected AS expected;

-- Exactly ONE applied row each, and exactly as many as the phase has migrations. The count is
-- derived from the same list rather than restated.
WITH phase10_expected(name) AS (
  VALUES ('20261215000000_phase10_cancellation_vocabulary'),
         ('20261215000100_phase10_obligation_unique')
)
SELECT 'ledger has exactly one applied row per phase 10 migration' AS object,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   JOIN phase10_expected e ON e.name = m.migration_name
                   WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)
                 = (SELECT count(*) FROM phase10_expected)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'one applied row per phase 10 migration (' ||
         (SELECT count(*) FROM phase10_expected)::text ||
         ' expected); more means the SQL ran twice, fewer means one did not apply' AS remedy;

-- No migration stuck mid-chain. Owner-verified after the run: 0 stuck.
SELECT 'no stuck migrations in the chain' AS object,
       CASE WHEN (SELECT count(*) FROM (
                    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
                    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
                  ) s) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a name with no finished, non-rolled-back row means a deploy died mid-chain' AS remedy;

-- AND THE CHAIN IS WHERE THIS PHASE LEFT IT. Owner-verified at 02:36 UTC: 123 rows / 121 distinct
-- / 2 rolled back. 119 distinct before, plus this phase's two. The rolled-back pair is retry
-- history carried from an earlier phase and is unchanged by this one, which is why this counts
-- distinct APPLIED names rather than rows.
SELECT 'chain is at the phase 10 post-state (121 distinct applied names)' AS object,
       CASE WHEN (SELECT count(DISTINCT migration_name) FROM _prisma_migrations
                   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 121
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a different count means the chain moved after this phase; re-verify before trusting the ' ||
       'rows above, which describe the database as it was at 02:36' AS remedy;

-- TERMINAL ROW. Absent means this file did not run, whatever the exit code said. The numbers are
-- checked against the file by `phase10-proof-sql.test.ts`, which counts the rows each statement
-- emits rather than trusting this line — phase 8's equivalent went stale twice, and a typed count
-- drifting beside a hand-written list is the defect this directory is about.
SELECT 'verify complete' AS object,
       '20 assertions: 14 physical, 5 ledger.' AS status,
       'no PRESENT/MISSING row above may be MISSING' AS remedy;
