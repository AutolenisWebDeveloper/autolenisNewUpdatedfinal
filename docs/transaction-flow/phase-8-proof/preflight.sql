-- Phase 8 preflight — §13-D30's e-sign signer cutover and §Stage 14's clearance columns.
--
-- CONTRACT: every row returns a `verdict` of CHECKED or BLOCK. A BLOCK stops the run. The
-- terminal row reports how many assertions ran, so a preflight that produced NO OUTPUT —
-- the silent zero-row result that looks exactly like success — is detectable by the caller:
-- no CHECKED row means the query did not run.
--
-- READ-ONLY. Run inside a server-enforced read-only transaction:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f preflight.sql
--
-- WHAT THIS PHASE IS ABOUT TO DO, and therefore what must be true first:
--
--   20261117000000_phase8_esign_signer_cutover  DROPS e_sign_envelopes_deal_id_key.
--   20261117000100_phase8_funding_clearance     adds four nullable columns to financing.
--
-- The drop is the dangerous half and its precondition is not "the composite index exists"
-- alone: it is that the composite index exists AND is valid AND no deal already holds two
-- envelopes. Dropping the absolute unique without the replacement in place would leave
-- e_sign_envelopes with NO uniqueness on deal_id at all, which is worse than the problem.

\pset footer off

-- 1. THE REPLACEMENT MUST BE PRESENT. Phase 1 (20261106000100:1114-1115) created it.
SELECT 'replacement index e_sign_envelopes_deal_id_signer_kind_key' AS assertion,
       CASE WHEN count(*) = 1 THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'e_sign_envelopes_deal_id_signer_kind_key';

-- 2. AND IT MUST BE VALID. A CREATE INDEX CONCURRENTLY that failed leaves an INVALID index
--    that is present in pg_indexes and enforces nothing. Presence alone is not the check.
SELECT 'replacement index is VALID (not a failed concurrent build)' AS assertion,
       coalesce((SELECT CASE WHEN i.indisvalid THEN 'valid' ELSE 'INVALID' END
                   FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                  WHERE c.relname = 'e_sign_envelopes_deal_id_signer_kind_key'), 'missing') AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                          WHERE c.relname = 'e_sign_envelopes_deal_id_signer_kind_key' AND i.indisvalid)
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict;

-- 3. THE INDEX BEING DROPPED MUST STILL EXIST. If it is already gone, the migration has run
--    (or something else dropped it) and this is not a fresh deploy — REPORTED, not assumed.
SELECT 'index to drop e_sign_envelopes_deal_id_key' AS assertion,
       CASE WHEN count(*) = 1 THEN 'present, will be dropped' ELSE 'already absent' END AS detail,
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'e_sign_envelopes_deal_id_key';

-- 4. NO DEAL MAY ALREADY HOLD TWO ENVELOPES. Vacuous while the absolute unique stands, and
--    asserted anyway — the guarantee is CHECKED rather than reasoned about, which is the
--    difference between a preflight and a comment.
SELECT 'deals holding more than one envelope' AS assertion,
       count(*)::text AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (SELECT deal_id FROM e_sign_envelopes GROUP BY deal_id HAVING count(*) > 1) d;

-- 5. EVERY ROW MUST CARRY A signer_kind. NOT NULL DEFAULT 'BUYER' makes this true by
--    construction — asserted because "true by construction" is exactly the claim that turns
--    out to be false when a column was added by a path nobody remembers.
SELECT 'envelopes with a NULL signer_kind' AS assertion,
       count(*)::text AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM e_sign_envelopes WHERE signer_kind IS NULL;

-- 6. THE CO-BUYER COLUMN AND ITS FK, which Phase 8's Prisma relation now declares. A
--    declared relation against an absent column is a 42703 on every read of the model.
SELECT 'e_sign_envelopes.co_buyer_id column' AS assertion,
       CASE WHEN count(*) = 1 THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'e_sign_envelopes' AND column_name = 'co_buyer_id';

SELECT 'e_sign_envelopes_co_buyer_id_fkey' AS assertion,
       CASE WHEN count(*) = 1 THEN 'present' ELSE 'ABSENT' END AS detail,
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM pg_constraint
 WHERE conname = 'e_sign_envelopes_co_buyer_id_fkey';

-- 7. THE FOUR CLEARANCE COLUMNS MUST NOT ALREADY EXIST. `ADD COLUMN IF NOT EXISTS` would
--    silently no-op over a column of a DIFFERENT type added out of band, and the clearance
--    evaluation would then read a column it did not define. Reported, not assumed.
SELECT 'financing clearance columns not already present' AS assertion,
       coalesce(string_agg(column_name, ', ' ORDER BY column_name), 'none') AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'financing'
   AND column_name IN ('lender_conditions_cleared_at', 'down_payment_method',
                       'dealer_funding_confirmed_at', 'funding_recorded_by');

-- 8. THE LEDGER MUST NOT ALREADY CARRY EITHER MIGRATION. Counted the way migration 110's
--    preflight was rewritten to count: FINISHED and NOT rolled back. A rolled-back row
--    sitting beside a success is retry history, not a fault, and must not read as applied.
SELECT 'phase 8 migrations not yet applied' AS assertion,
       coalesce(string_agg(migration_name, ', ' ORDER BY migration_name), 'none') AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM _prisma_migrations
 WHERE migration_name IN ('20261117000000_phase8_esign_signer_cutover',
                          '20261117000100_phase8_funding_clearance')
   AND finished_at IS NOT NULL AND rolled_back_at IS NOT NULL IS NOT TRUE
   AND rolled_back_at IS NULL;

-- 9. NO MIGRATION IS STUCK. A name with no finished, non-rolled-back row means a prior
--    deploy died mid-chain, and running another on top of it is how a chain forks.
SELECT 'stuck migrations' AS assertion,
       CASE WHEN count(*) = 0 THEN 'none' ELSE string_agg(migration_name, ', ') END AS detail,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict
  FROM (
    SELECT migration_name FROM _prisma_migrations GROUP BY migration_name
    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
  ) stuck;

-- 10. THE CHAIN AS A WHOLE, reported for the record. Production reads 115 rows against 113
--     distinct names before this wave, and the repository holds 113 migration directories —
--     the two extra rows are retry history, which is why the assertions above count
--     finished, non-rolled-back rows rather than rows.
SELECT 'chain totals (reported, never a BLOCK)' AS assertion,
       count(*)::text || ' rows / ' || count(DISTINCT migration_name)::text || ' distinct / '
         || count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || ' rolled back' AS detail,
       'CHECKED' AS verdict
  FROM _prisma_migrations;

-- TERMINAL ROW. If this is absent the preflight did not run, whatever the exit code said.
SELECT 'preflight complete' AS assertion,
       '10 assertions' AS detail,
       'CHECKED' AS verdict;
