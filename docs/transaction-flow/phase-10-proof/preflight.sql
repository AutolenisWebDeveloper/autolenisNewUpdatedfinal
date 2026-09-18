-- Phase 10 preflight — the §24 CANCELLATION VOCABULARY (20261215000000) and §13-D60's
-- PARTIAL UNIQUE on post_completion_obligations (20261215000100).
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────────┐
-- │ THIS FILE WAS AUTHORED AFTER THE FACT AND NEVER GATED A RUN.                              │
-- │                                                                                          │
-- │ The owner applied both migrations to production at 02:36 UTC on 2026-09-18 WITHOUT a      │
-- │ preflight, because there was no `docs/transaction-flow/phase-10-proof/` on the branch to  │
-- │ run one from. Phase 1, phases 3 through 9 and migration-110 all ship a proof package;     │
-- │ Phase 10 did not. The STOP 2 report described this sequence — "preflight.sql in full      │
-- │ before, prisma migrate status to show what will apply, and both verification halves       │
-- │ after" — and the files behind that sentence were never written. Owner-instructed          │
-- │ follow-up, 2026-09-18.                                                                    │
-- │                                                                                          │
-- │ SO THIS FILE GUARDED NOTHING. It is written against the PRE-DEPLOY state deliberately —   │
-- │ a preflight rewritten to pass against the post-deploy database would be a different file  │
-- │ pretending to be this one. Run TODAY it BLOCKS, correctly, on assertions 9 and 11: the    │
-- │ migrations are applied and the chain has moved from 119 distinct names to 121. That is    │
-- │ the file working, not failing. What it is for is the NEXT operator, and the record of     │
-- │ what should have been checked before 02:36.                                               │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘
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
--   20261215000000_phase10_cancellation_vocabulary
--     1. ALTER TYPE "AuctionInvitationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED'
--     2. ALTER TYPE "PickupStatus"            ADD VALUE IF NOT EXISTS 'CANCELLED'
--   20261215000100_phase10_obligation_unique
--     3. CREATE UNIQUE INDEX IF NOT EXISTS post_completion_obligations_open_deal_type_key
--          ON post_completion_obligations (deal_id, type) WHERE status <> 'RESOLVED'
--     4. COMMENT ON INDEX ...
--
-- THE UNIQUE INDEX IS THE DANGEROUS HALF, exactly as it was in Phase 9. `CREATE UNIQUE INDEX`
-- over a table that already holds two matching rows fails the whole migration mid-chain. The
-- pairs it would collide on are asserted below rather than reasoned about from the claim that
-- `openObligation` has a single writer — that is a claim about the code, and this file's job is
-- to check the database.
--
-- THE ENUM HALF IS THE IRREVERSIBLE ONE, and it is irreversible in a way no rollback file can
-- soften: PostgreSQL cannot drop an enum label. Nothing here can undo it, so what this file
-- checks is that the two types exist to be altered and that neither already carries the label by
-- some path nobody reviewed.

\pset footer off

-- ── THE OBJECTS THE MIGRATION NEEDS ─────────────────────────────────────────

-- 1. BOTH ENUM TYPES MUST EXIST. `ALTER TYPE` on a name that is not there is 42704 and takes the
--    chain down at statement 1. They arrived with the Phase 1 wave.
SELECT 'enum type ' || expected.name AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname = expected.name)
            THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname = expected.name)
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (VALUES ('AuctionInvitationStatus'), ('PickupStatus')) AS expected(name);

-- 2. NEITHER TYPE MAY ALREADY CARRY 'CANCELLED'. Both statements carry `ADD VALUE IF NOT EXISTS`,
--    which is what makes re-application a no-op — and also what would let a label added OUT OF
--    BAND survive silently while the ledger records this migration as applied. Same reasoning as
--    Phase 9 applies to its indexes. An enum label cannot be dropped, so a label added by the
--    wrong path cannot be tidied away afterwards; it can only be discovered.
--
--    THE PRE-DEPLOY READING, owner census: AuctionInvitationStatus held 10 labels
--    (QUEUED, SENT, DELIVERED, OPENED, BOUNCED, DECLINED, RESPONDED, OFFER_SUBMITTED, EXPIRED,
--    REPLACED) and PickupStatus held 10 (NOT_SCHEDULED, PROPOSED, DEALER_COUNTERED, SCHEDULED,
--    CHECKED_IN, COMPLETED, RESCHEDULED, EXCEPTION, NO_SHOW, RELEASED). Neither carried CANCELLED.
SELECT expected.name || ' does not already carry CANCELLED' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                          WHERE t.typname = expected.name AND e.enumlabel = 'CANCELLED')
            THEN 'ALREADY PRESENT — added out of band?' ELSE 'absent, will be added' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                          WHERE t.typname = expected.name AND e.enumlabel = 'CANCELLED')
            THEN 'BLOCK' ELSE 'CHECKED' END AS verdict
  FROM (VALUES ('AuctionInvitationStatus'), ('PickupStatus')) AS expected(name);

-- 3. THE TABLE THE INDEX IS BUILT ON MUST EXIST.
SELECT 'post_completion_obligations table' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_schema = 'public' AND table_name = 'post_completion_obligations')
            THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_schema = 'public' AND table_name = 'post_completion_obligations')
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict;

-- 4. AND THE THREE COLUMNS THE INDEX NAMES. Two are the key, one is the predicate. Any one absent
--    is a 42703 inside the CREATE, which fails the migration rather than degrading the index.
SELECT 'post_completion_obligations.' || expected.name || ' column' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'post_completion_obligations'
                            AND column_name = expected.name)
            THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'post_completion_obligations'
                            AND column_name = expected.name)
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (VALUES ('deal_id'), ('type'), ('status')) AS expected(name);

-- 5. THE PREDICATE LITERAL MUST BE A VALID LABEL. `status` is not text — it is the enum
--    `PostCompletionObligationStatus` (PENDING, OVERDUE, RESOLVED). The index predicate compares
--    it to the literal 'RESOLVED', so the label must exist on that type or the CREATE fails on a
--    cast it cannot make. A text column would make this assertion unnecessary; an enum makes it
--    the difference between a partial index and a failed migration.
SELECT 'PostCompletionObligationStatus carries the RESOLVED label (the index predicate)' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                          WHERE t.typname = 'PostCompletionObligationStatus' AND e.enumlabel = 'RESOLVED')
            THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                          WHERE t.typname = 'PostCompletionObligationStatus' AND e.enumlabel = 'RESOLVED')
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict;

-- 6. THE INDEX MAY NOT ALREADY EXIST. `IF NOT EXISTS` is what makes re-application a no-op, and
--    also what would let an index of this name with a DIFFERENT predicate survive while the
--    ledger records the migration as applied. A predicate that drifts from
--    `status <> 'RESOLVED'` enforces a different rule than §13-D60 ruled, and enforces it
--    silently.
SELECT 'index post_completion_obligations_open_deal_type_key not already present' AS assertion,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                          AND indexname = 'post_completion_obligations_open_deal_type_key')
            THEN 'ALREADY PRESENT' ELSE 'absent, will be created' END AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                          AND indexname = 'post_completion_obligations_open_deal_type_key')
            THEN 'BLOCK' ELSE 'CHECKED' END AS verdict;

-- 7. NO TWO OPEN OBLIGATIONS MAY SHARE (deal_id, type). THIS IS THE ASSERTION THE MIGRATION CAN
--    FAIL ON. It is scoped exactly as the index is — `status <> 'RESOLVED'` — because a RESOLVED
--    duplicate is legitimate under §13-D60's partial carve-out and must not read as a blocker.
--
--    OWNER CENSUS BEFORE THE RUN: 0 duplicates, against 0 obligation rows (deals held 0, so
--    post_completion_obligations held 0 by foreign key). CREATE UNIQUE INDEX would fail loudly on
--    a duplicate rather than silently dropping one, which is the correct behaviour if that
--    assumption is ever wrong: a failed migration is recoverable, a silently discarded obligation
--    is not — the migration header says exactly this.
--
--    EXERCISED, AND AGAINST REAL ROWS RATHER THAN AN EMPTY TABLE. Phase 9's equivalent shipped
--    reading 0 of 0 — it passed while checking nothing, which is §8.1h's class arriving inside
--    the file written to catch it. Two PENDING obligations sharing one (deal_id, type) were
--    seeded on a throwaway loopback cluster: this assertion reported 1 and BLOCK, and applying
--    20261215000100 with the duplicate present died on
--    `ERROR: could not create unique index "post_completion_obligations_open_deal_type_key"`
--    / `DETAIL: Key (deal_id, type)=(...) is duplicated`. Resolving one of the two returned this
--    assertion to CHECKED and the migration applied. Recorded in proof-run.log under THIRD RUN.
SELECT 'duplicate OPEN (deal_id, type) pairs (what CREATE UNIQUE INDEX fails on)' AS assertion,
       count(*)::text AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (SELECT deal_id, type FROM post_completion_obligations
         WHERE status <> 'RESOLVED' GROUP BY deal_id, type HAVING count(*) > 1) d;

-- ── THE LEDGER ──────────────────────────────────────────────────────────────

-- 8. THE EXPECTED SET, DECLARED ONCE. Every count below is derived from this list and no total is
--    restated as a literal. Phase 8's verify.sql named two of its four migrations in two separate
--    hardcoded lists and would have reported a clean deploy with the other two missing;
--    `phase10-proof-sql.test.ts` checks this list against the directories on disk so that a
--    Phase 10 migration added later cannot leave this file quietly short.
--
-- 9. NEITHER MIGRATION MAY ALREADY BE APPLIED. Counted FINISHED and NOT rolled back: a
--    rolled-back row sitting beside a success is retry history, not a fault, and must not read as
--    applied. Production carried two such rows before this phase and carries two after.
--
--    THIS IS ONE OF THE TWO ASSERTIONS THAT BLOCK TODAY. Both names were applied at 02:36 UTC on
--    2026-09-18, so a run against production now reports ALREADY APPLIED twice. Correct.
WITH phase10_expected(name) AS (
  VALUES ('20261215000000_phase10_cancellation_vocabulary'),
         ('20261215000100_phase10_obligation_unique')
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
  FROM phase10_expected AS expected;

-- 10. NO MIGRATION IS STUCK. A name with no finished, non-rolled-back row means a prior deploy
--     died mid-chain, and running another on top of it is how a chain forks. Owner census before
--     the run: 0 stuck. After: 0 stuck.
SELECT 'stuck migrations' AS assertion,
       CASE WHEN count(*) = 0 THEN 'none' ELSE string_agg(migration_name, ', ') END AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (
    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
  ) stuck;

-- 11. THE CHAIN IS WHERE THE OWNER LEFT IT. Verified against production immediately before the
--     run: 121 rows / 119 distinct / 2 rolled back / 0 stuck. The repository holds 121 migration
--     directories at this commit — 119 already applied plus this phase's two — and the two extra
--     ledger ROWS are retry history, which is why every assertion above counts finished,
--     non-rolled-back rows rather than rows.
--
--     THIS BLOCKS ON A MISMATCH, DELIBERATELY, AND IT BLOCKS TODAY. Production now reads 121
--     distinct. A different count means these preconditions describe a database that no longer
--     exists, and the correct response is to re-verify and write a new preflight for whatever is
--     being applied next — not to edit this number so an expired snapshot reads green.
SELECT 'chain is at the verified pre-state (119 distinct applied names)' AS assertion,
       count(DISTINCT migration_name)::text || ' distinct / '
         || count(*)::text || ' rows / '
         || count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || ' rolled back' AS detail,
       CASE WHEN count(DISTINCT migration_name) FILTER (
                   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 119
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM _prisma_migrations;

-- ── THE WORLD THIS RUNS AGAINST, REPORTED ───────────────────────────────────
--
-- None of the following is a BLOCK. Both migrations are correct whether these tables hold
-- nought rows or ten thousand. These rows exist so the scale is known BEFORE the run rather than
-- inferred from its result afterwards.

-- 12. HOW MANY OBLIGATIONS THE INDEX WILL HAVE TO COVER. Owner-verified 0 before the run, which
--     is why NO BACKFILL AND NO CLEANUP was required and why that was checked rather than assumed.
SELECT 'post_completion_obligations rows' AS assertion,
       count(*)::text || ' total, '
         || count(*) FILTER (WHERE status <> 'RESOLVED')::text || ' open' AS detail,
       'CHECKED' AS verdict
  FROM post_completion_obligations;

-- 13. THE OPERATIONS REGISTER, because §26 rows are what the cancellation orchestration writes
--     and their count is the closest thing to a load reading for the surface this phase adds.
--     Owner-verified 20 before the run.
SELECT 'queue_items rows' AS assertion,
       count(*)::text AS detail,
       'CHECKED' AS verdict
  FROM queue_items;

-- 14. AND THE SURROUNDING TRANSACTION VOLUME. Owner-verified: deals 0.
SELECT 'deals on the platform' AS assertion,
       count(*)::text AS detail,
       'CHECKED' AS verdict
  FROM deals;

-- 15. THE SCHEDULER IS HEALTHY. A cron failing while a migration lands makes the two
--     indistinguishable in the incident that follows.
--
--     NOT ZERO BEFORE THIS RUN, and reported rather than blocked: the owner recorded ONE failure
--     in the preceding 24 hours — the MarketCheck price-side sweep at 08:00:06, "normalization
--     dropped 50 of 50 listings, sampled 25: price 25" — already parked by a standing ruling and
--     unrelated to anything either migration touches. One known, ruled failure out of 12,003 runs
--     is a reported number; it is the reader who decides, which is why this row cannot BLOCK.
SELECT 'cron failures in the last 24 hours' AS assertion,
       count(*)::text AS detail,
       'CHECKED' AS verdict
  FROM cron_job_logs
 WHERE status = 'FAILED' AND started_at > now() - interval '24 hours';

-- TERMINAL ROW. If this is absent the preflight did not run, whatever the exit code said. The
-- numbers are checked against the file by `phase10-proof-sql.test.ts`, which counts the rows each
-- statement emits rather than trusting this line.
SELECT 'preflight complete' AS assertion,
       '20 assertions: 15 block-capable, 4 reported' AS detail,
       'CHECKED' AS verdict;
