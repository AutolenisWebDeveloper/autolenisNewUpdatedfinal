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

-- ── HALF ONE, CONTINUED: THE OBJECTS OF MIGRATIONS 000200 AND 000300 ─────────
--
-- ADDED 2026-09-15, AND THE REASON IS THE POINT OF THIS FILE.
--
-- The ledger half was corrected earlier today to name all four migrations instead of two.
-- The PHYSICAL half was not, and nobody checked it: assertions 1-10 above cover only
-- `e_sign_envelopes`' index cutover and `financing`'s clearance columns — the objects of
-- migrations 000000 and 000100. `executed_document_key`, the three `signer_access_token_*`
-- columns and the two token indexes appeared NOWHERE in this file.
--
-- So the corrected file still had the property the correction was supposed to remove. Run it
-- against a database where 000200 and 000300 were recorded with `migrate resolve --applied`
-- and their SQL never executed, and every row prints PRESENT: the ledger half is satisfied by
-- the rows, and the physical half never mentions the objects. That is verbatim the failure
-- this file's own header condemns — "a ledger row with a missing object is a silent lie" —
-- reached by fixing one half and declaring the file fixed.
--
-- The owner verified these seven objects BY HAND at 17:33 UTC on 2026-09-15, which is the
-- tell: a proof file is wrong when the person running it has to check something it does not.

-- 11. MIGRATION 000200's ONLY OBJECT. `ADD COLUMN IF NOT EXISTS` no-ops silently over a
--     column added out of band, so the ledger row for 000200 proves nothing about the column.
SELECT 'contract_versions.executed_document_key' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'contract_versions'
                            AND column_name = 'executed_document_key')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the executed artefact has nowhere to be stored; §13-D4 activation writes into this' AS remedy;

-- 12-14. MIGRATION 000300's THREE TOKEN COLUMNS. The invited co-buyer signing surface reads
--     all three on every request; absent means 42703 on the first co-buyer to click a link.
SELECT 'e_sign_envelopes.' || expected.name AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'e_sign_envelopes'
                            AND column_name = expected.name)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'resolveSignerToken reads this; absent means every invited-signer request 42703s' AS remedy
  FROM (VALUES ('signer_access_token_hash'), ('signer_access_token_expires_at'),
               ('signer_access_token_consumed_at')) AS expected(name);

-- 15. AND THE TWO TIMESTAMPS ARE TIME-ZONE NAIVE. Not cosmetic: the drift gate caught these
--     as the only tz-AWARE columns on a table of twelve tz-naive ones, and `resolveSignerToken`
--     compares them directly against the other eleven. A TIMESTAMPTZ here puts the signing
--     window out by the server's UTC offset — a token that expires early or late, silently,
--     and only for co-buyers. Asserted because the type is the correctness property, not the
--     column's mere existence.
SELECT 'e_sign_envelopes signer token timestamps are tz-naive' AS object,
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'e_sign_envelopes'
                     AND column_name IN ('signer_access_token_expires_at', 'signer_access_token_consumed_at')
                     AND data_type = 'timestamp without time zone') = 2
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a TIMESTAMPTZ here shifts every co-buyer signing window by the UTC offset' AS remedy;

-- 16. THE UNIQUE INDEX ON THE TOKEN HASH, AND IT IS VALID. This is what makes a token
--     single-use-able at all: without it two envelopes can carry the same hash.
SELECT 'index e_sign_envelopes_signer_access_token_hash_key is VALID' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                          WHERE c.relname = 'e_sign_envelopes_signer_access_token_hash_key'
                            AND i.indisvalid)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'without a valid unique index two envelopes can share a token hash' AS remedy;

-- 17. THE PARTIAL LIVE-TOKEN INDEX. Its WHERE clause is the definition of "live", so an index
--     present with the wrong predicate is worse than one absent — it silently scans the wrong set.
SELECT 'index e_sign_envelopes_live_signer_token_idx, with its partial predicate' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public'
                            AND indexname = 'e_sign_envelopes_live_signer_token_idx'
                            AND indexdef LIKE '%signer_access_token_hash IS NOT NULL%'
                            AND indexdef LIKE '%signer_access_token_consumed_at IS NULL%')
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'the partial predicate IS the definition of a live token; a wrong one scans the wrong set' AS remedy;

-- ── HALF TWO: THE LEDGER ─────────────────────────────────────────────────────
-- Counted the way migration 110's preflight was rewritten to count: FINISHED and NOT rolled
-- back. A rolled-back row sitting beside a success is RETRY HISTORY, not a fault, and must
-- render as PRESENT rather than MISSING — production reads 115 rows against 113 distinct
-- names for exactly that reason.

-- THE EXPECTED SET, DECLARED ONCE.
--
-- It used to be written out twice — once as a VALUES list and once as an IN list — and both
-- named only the first two migrations. `executed_copy_storage` and `invited_signer_token`
-- were added to the phase afterwards and neither list was updated, so this file would have
-- reported PRESENT on a deploy with HALF THE MIGRATIONS MISSING. It under-asserted rather
-- than mis-asserted, which is worse: a verify that cannot fail is the exact class of gate
-- §8.1h spends its report warning about, and it was sitting inside the proof directory.
--
-- Found by the owner's independent verification at 17:33 UTC, after all four had applied.
--
-- ONE list now, consumed by both queries below, so the two can no longer disagree. The list
-- itself is checked against the migration directories on disk by
-- `frontend/prisma/__tests__/phase8-proof-sql.test.ts`, which fails the build when a Phase 8
-- migration is added and this file is not updated — because a list maintained by hand is how
-- this drifted in the first place.
WITH phase8_expected(name) AS (
  VALUES ('20261117000000_phase8_esign_signer_cutover'),
         ('20261117000100_phase8_funding_clearance'),
         ('20261117000200_phase8_executed_copy_storage'),
         ('20261117000300_phase8_invited_signer_token')
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
  FROM phase8_expected AS expected;

-- Exactly ONE applied row each, and exactly as many as the phase has migrations. The count is
-- derived from the same list rather than restated as a literal — a hardcoded `= 2` beside a
-- four-name list is precisely the drift this file just suffered.
WITH phase8_expected(name) AS (
  VALUES ('20261117000000_phase8_esign_signer_cutover'),
         ('20261117000100_phase8_funding_clearance'),
         ('20261117000200_phase8_executed_copy_storage'),
         ('20261117000300_phase8_invited_signer_token')
)
SELECT 'ledger has exactly one applied row per phase 8 migration' AS object,
       CASE WHEN (SELECT count(*) FROM _prisma_migrations m
                   JOIN phase8_expected e ON e.name = m.migration_name
                   WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)
                 = (SELECT count(*) FROM phase8_expected)
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'one applied row per phase 8 migration (' ||
         (SELECT count(*) FROM phase8_expected)::text ||
         ' expected); more means the SQL ran twice, fewer means one did not apply' AS remedy;

-- No migration stuck mid-chain.
SELECT 'no stuck migrations in the chain' AS object,
       CASE WHEN (SELECT count(*) FROM (
                    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
                    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
                  ) s) = 0
            THEN 'PRESENT' ELSE 'MISSING' END AS status,
       'a name with no finished, non-rolled-back row means a deploy died mid-chain' AS remedy;

-- TERMINAL ROW. Absent means this file did not run, whatever the exit code said.
--
-- THE COUNT WAS WRONG, AND IT WAS WRONG IN THE FIX. It read "16 assertions: 13 physical,
-- 3 ledger" — a split that never matched the file (11 physical, 4 ledger, 1 terminal even
-- before today), and whose TOTAL went stale the moment this morning's correction grew the
-- ledger CTE from two names to four. A file whose entire subject is a typed count drifting
-- beside a hand-written list shipped a typed count that drifted beside a hand-written list.
--
-- It is no longer maintained by hand. `frontend/prisma/__tests__/phase8-proof-sql.test.ts`
-- parses this file, computes the rows it actually emits — one per assertion, N per VALUES
-- list, one per name in the phase8_expected CTE — and fails the build when these three
-- numbers disagree with it. A typed number checked by nothing is the whole subject of §8.1h.
SELECT 'verify complete — BOTH halves' AS object,
       'PRESENT' AS status,
       '25 assertions: 18 physical, 6 ledger. A MISSING row is REPORTED, never repaired with DDL.' AS remedy;
