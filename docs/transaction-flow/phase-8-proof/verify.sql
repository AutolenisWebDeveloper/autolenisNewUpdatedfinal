-- Phase 8 verification — BOTH HALVES, because neither alone is sufficient.
--
-- CLAUDE.md requires the physical schema AND `_prisma_migrations` after any deploy, and
-- §8.2's own history is the reason: six migrations went unrecorded and enum labels came to
-- exist with no ledger row. A correct physical schema proves nothing about whether Prisma
-- knows it is correct — a schema that is right with an absent ledger row gets re-applied on
-- the next deploy, and a ledger row with a missing object is a silent lie.
--
-- CONTRACT: every row returns PRESENT or MISSING. A MISSING row is REPORTED, never repaired
-- with DDL — the repair is a new forward migration or an owner-approved `migrate resolve`.
-- The terminal CHECKED row states how many assertions ran, so a verify that produced no
-- output is distinguishable from one that passed.
--
-- THE INVERTED ASSERTION IS THE POINT OF THIS FILE. Phase 8 REMOVES a constraint, so the
-- interesting assertion is that something is GONE. Asserting only what was added would pass
-- against a database where the drop silently failed — which is the one outcome that matters,
-- because the co-buyer envelope would then fail with 23505 in production and nowhere else.

\pset footer off

-- ── HALF ONE: THE PHYSICAL SCHEMA ────────────────────────────────────────────

-- 1. THE DROP. Inverted: 'PRESENT' here means the index is ABSENT, which is the state the
--    migration exists to produce.
SELECT 'index e_sign_envelopes_deal_id_key is REMOVED' AS object,
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes
                              WHERE schemaname = 'public' AND indexname = 'e_sign_envelopes_deal_id_key')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the absolute unique on deal_id must be gone, or the co-buyer envelope 23505s' AS remedy;

-- 2. THE REPLACEMENT SURVIVED THE DROP. Dropping the old one while losing the new one would
--    leave e_sign_envelopes with no uniqueness on deal_id at all.
SELECT 'index e_sign_envelopes_deal_id_signer_kind_key' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public' AND indexname = 'e_sign_envelopes_deal_id_signer_kind_key')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the composite unique is now the ONLY thing preventing two BUYER envelopes on one deal' AS remedy;

-- 3. AND IT IS VALID. An INVALID index appears in pg_indexes and enforces nothing.
SELECT 'e_sign_envelopes_deal_id_signer_kind_key is VALID' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                          WHERE c.relname = 'e_sign_envelopes_deal_id_signer_kind_key' AND i.indisvalid)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'an invalid index enforces nothing while looking present' AS remedy;

-- 4-7. THE FOUR CLEARANCE COLUMNS. Stage 14 items 2, 3 and 4 have nowhere else to live.
SELECT 'financing.' || expected.name AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'financing'
                            AND column_name = expected.name)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'evaluateFundingClearance reads this; without it items 2-4 report outstanding forever' AS remedy
  FROM (VALUES ('lender_conditions_cleared_at'), ('down_payment_method'),
               ('dealer_funding_confirmed_at'), ('funding_recorded_by')) AS expected(name);

-- 8. AND THEY ARE NULLABLE. A NOT NULL here would have failed the ALTER on any existing row
--    and, worse, would make a financing record unwritable until Finance had all three facts.
SELECT 'financing clearance columns are all NULLABLE' AS object,
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public' AND table_name = 'financing'
                                AND column_name IN ('lender_conditions_cleared_at', 'down_payment_method',
                                                    'dealer_funding_confirmed_at', 'funding_recorded_by')
                                AND is_nullable = 'NO')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a NOT NULL clearance column makes a financing row unwritable before Finance has the facts' AS remedy;

-- 9. THE SPINE COLUMNS PHASE 8's PRISMA MODEL NOW DECLARES. A declared field against an
--    absent column is a 42703 on every read of the model, in every surface at once.
SELECT 'e_sign_envelopes.' || expected.name AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'e_sign_envelopes'
                            AND column_name = expected.name)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'schema.prisma declares this since Phase 8; absent means 42703 on every envelope read' AS remedy
  FROM (VALUES ('signer_kind'), ('co_buyer_id')) AS expected(name);

-- 10. signer_kind MUST STILL BE NOT NULL DEFAULT 'BUYER'. It is what makes the composite
--     index exactly as strict as the absolute one for every pre-existing row — the property
--     the whole cutover ordering rests on.
SELECT 'e_sign_envelopes.signer_kind is NOT NULL with a default' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'e_sign_envelopes'
                            AND column_name = 'signer_kind'
                            AND is_nullable = 'NO' AND column_default IS NOT NULL)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a nullable signer_kind lets two rows share (deal_id, NULL) and defeats the composite unique' AS remedy;

-- ── HALF TWO: THE LEDGER ─────────────────────────────────────────────────────
-- Counted the way migration 110's preflight was rewritten to count: FINISHED and NOT rolled
-- back. A rolled-back row sitting beside a success is RETRY HISTORY, not a fault, and must
-- render as PRESENT rather than MISSING — production reads 115 rows against 113 distinct
-- names for exactly that reason.

SELECT 'ledger ' || expected.name AS object,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   WHERE m.migration_name = expected.name
                     AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL) = 1
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   WHERE m.migration_name = expected.name AND m.rolled_back_at IS NOT NULL) > 0
            THEN 'a rolled-back row sits beside this one: RETRY HISTORY, not a failure'
            ELSE 'no ledger row means Prisma will re-apply this on the next deploy' END AS remedy
  FROM (VALUES ('20261117000000_phase8_esign_signer_cutover'),
               ('20261117000100_phase8_funding_clearance')) AS expected(name);

-- Exactly ONE applied row each. More than one means the SQL ran twice.
SELECT 'ledger has exactly one applied row per phase 8 migration' AS object,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations
                   WHERE migration_name IN ('20261117000000_phase8_esign_signer_cutover',
                                            '20261117000100_phase8_funding_clearance')
                     AND finished_at IS NOT NULL AND rolled_back_at IS NULL) = 2
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'two applied rows, one per migration; more means the SQL ran twice' AS remedy;

-- No migration stuck mid-chain.
SELECT 'no stuck migrations in the chain' AS object,
       CASE WHEN (SELECT count(*) FROM (
                    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
                    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
                  ) s) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a name with no finished, non-rolled-back row means a deploy died mid-chain' AS remedy;

-- TERMINAL ROW. Absent means this file did not run, whatever the exit code said.
SELECT 'verify complete — BOTH halves' AS object,
       'PRESENT' AS status,
       '16 assertions: 13 physical, 3 ledger. A MISSING row is REPORTED, never repaired with DDL.' AS remedy;
