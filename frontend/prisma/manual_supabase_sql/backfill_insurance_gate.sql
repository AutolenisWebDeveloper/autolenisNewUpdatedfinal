-- backfill_insurance_gate.sql
--
-- ⚠️ OWNER-GATED, MANUAL, NOT APPLIED. This is a DATA backfill, deliberately kept
-- out of prisma/migrations/ so that `prisma migrate deploy` can never run it as a
-- side effect of a deploy. Run it only intentionally, against a known environment.
--
-- ⚠️ PREFER THE SCRIPT: `npx tsx prisma/backfill-insurance-gate.ts --apply`.
-- The script routes every deal through advanceDealStatus, so it inherits the
-- compare-and-swap, the expectedFrom from-guard, the insurance gate,
-- BuyerActivityEvent, and the customer communication. This SQL is the fallback for
-- environments where running Node against the database is not possible. It
-- reproduces the status change and the DealStatusHistory row, but it CANNOT emit
-- BuyerActivityEvent or the CONTRACT_PENDING customer message — affected buyers
-- will simply see their deal in the contract stage with no notification. That is a
-- deliberate trade-off, and for some backfills (old deals, where a sudden burst of
-- "your dealer is preparing your contract" messages would confuse people) it is
-- the BETTER one. Choose consciously.
--
-- WHAT IT FIXES
-- INSURANCE_PENDING → CONTRACT_PENDING had no automatic driver: the only
-- buyer-facing insurance path wrote insuranceStatus and never advanced the deal, so
-- buyers who uploaded their own proof stalled invisibly. The code is fixed going
-- forward; these are the rows stranded before that fix shipped.
--
-- SAFETY
--  • Idempotent — the WHERE clause matches only still-stranded rows.
--  • Cannot touch COMPLETED / CANCELLED / REFUNDED (status is a single column and
--    the filter pins it to INSURANCE_PENDING).
--  • Cannot release a deal without proof — the insurance_status filter is the same
--    INSURANCE_SATISFIED set the application gate uses.
--  • Runs in a transaction; the history insert and the status change commit together.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — PREVIEW (read-only). Run this first and eyeball the count.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  d.id                AS deal_id,
  d.buyer_id,
  d.insurance_status,
  d.created_at,
  d.updated_at        AS stranded_since
FROM "deals" d
WHERE d.status = 'INSURANCE_PENDING'
  AND d.insurance_status IN ('VERIFIED', 'POLICY_BOUND', 'EXTERNAL_UPLOADED')
ORDER BY d.created_at ASC;

-- Count + age summary:
-- SELECT count(*) AS stranded, min(created_at) AS oldest, max(updated_at) AS newest
-- FROM "deals"
-- WHERE status = 'INSURANCE_PENDING'
--   AND insurance_status IN ('VERIFIED','POLICY_BOUND','EXTERNAL_UPLOADED');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — APPLY. Uncomment and run as one transaction.
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
--
-- -- Freeze the target set so the history rows and the update agree exactly, even
-- -- if live traffic advances a deal mid-statement.
-- CREATE TEMP TABLE _insurance_gate_backfill ON COMMIT DROP AS
-- SELECT id, status AS from_status
-- FROM "deals"
-- WHERE status = 'INSURANCE_PENDING'
--   AND insurance_status IN ('VERIFIED','POLICY_BOUND','EXTERNAL_UPLOADED')
-- FOR UPDATE;
--
-- -- Audit trail first: every transition must stay diagnosable.
-- INSERT INTO "deal_status_history" (id, deal_id, from_status, to_status, actor_id, actor_role, reason, created_at)
-- SELECT
--   gen_random_uuid()::text,
--   b.id,
--   b.from_status,
--   'CONTRACT_PENDING',
--   NULL,
--   'SYSTEM',
--   'Backfill: insurance proof already on file (insurance gate had no driver)',
--   now()
-- FROM _insurance_gate_backfill b;
--
-- -- Then the status change, re-checking both guards so a row that moved between
-- -- the snapshot and here is left alone rather than dragged backwards.
-- UPDATE "deals" d
-- SET status = 'CONTRACT_PENDING', updated_at = now()
-- FROM _insurance_gate_backfill b
-- WHERE d.id = b.id
--   AND d.status = 'INSURANCE_PENDING'
--   AND d.insurance_status IN ('VERIFIED','POLICY_BOUND','EXTERNAL_UPLOADED');
--
-- -- Sanity: expect 0 rows left stranded.
-- SELECT count(*) AS still_stranded
-- FROM "deals"
-- WHERE status = 'INSURANCE_PENDING'
--   AND insurance_status IN ('VERIFIED','POLICY_BOUND','EXTERNAL_UPLOADED');
--
-- COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — reverses ONLY the rows this backfill moved, identified by the
-- history rows it wrote. A deal legitimately advanced past CONTRACT_PENDING since
-- the backfill (to CONTRACT_REVIEW or beyond) is deliberately left alone.
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- UPDATE "deals" d
-- SET status = 'INSURANCE_PENDING', updated_at = now()
-- FROM "deal_status_history" h
-- WHERE h.deal_id = d.id
--   AND h.to_status = 'CONTRACT_PENDING'
--   AND h.reason = 'Backfill: insurance proof already on file (insurance gate had no driver)'
--   AND d.status = 'CONTRACT_PENDING';
--
-- INSERT INTO "deal_status_history" (id, deal_id, from_status, to_status, actor_id, actor_role, reason, created_at)
-- SELECT gen_random_uuid()::text, d.id, 'CONTRACT_PENDING', 'INSURANCE_PENDING', NULL, 'SYSTEM',
--        'Backfill rollback: insurance-gate backfill reverted', now()
-- FROM "deals" d
-- JOIN "deal_status_history" h ON h.deal_id = d.id
-- WHERE h.to_status = 'CONTRACT_PENDING'
--   AND h.reason = 'Backfill: insurance proof already on file (insurance gate had no driver)'
--   AND d.status = 'INSURANCE_PENDING';
-- COMMIT;
