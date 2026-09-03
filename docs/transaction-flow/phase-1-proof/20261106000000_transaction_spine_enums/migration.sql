-- Phase 1 wave, directory 1 of 2 — ENUM LABELS ONLY.
--
-- THIS IS A PROOF COPY. It deliberately does NOT live in frontend/prisma/migrations/, because
-- Phase 1 has not been authorised to begin. Its only purpose is to prove that the statements §8.2
-- specifies apply cleanly, in order, to an isolated PostgreSQL 17.6 database matching production's
-- server version, and that applying the complete pair a second time succeeds unchanged.
--
-- WHY THIS DIRECTORY EXISTS AT ALL: PostgreSQL refuses to use an enum label inside the transaction
-- that added it, and Prisma wraps each migration file in one transaction. Two objects in directory 2
-- name labels added here — the `vehicle_requests_one_open_per_buyer_key` predicate (DRAFT,
-- PAYMENT_REQUIRED, RADIUS_AUTHORIZATION_REQUIRED) and the legacy-path partial index
-- (`AdminActionType.LEGACY_PATH_WRITE`) — so they cannot share a transaction with these statements.
--
-- Every statement is idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-apply.
-- Enum labels are append-only; rollback.sql does not remove them.

-- ── Vehicle request lifecycle (§4.1, §5 rule 5/6, §32) ──────────────────────────────────────────
ALTER TYPE "VehicleRequestStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "VehicleRequestStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_REQUIRED';
ALTER TYPE "VehicleRequestStatus" ADD VALUE IF NOT EXISTS 'RADIUS_AUTHORIZATION_REQUIRED';

-- ── Deal lifecycle (§28, §32) ───────────────────────────────────────────────────────────────────
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'DEALER_CONFIRMATION';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'RECAP_PENDING';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'DEALER_EXECUTED';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'FUNDING_PENDING';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'PICKUP_READINESS';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'HANDOVER_PENDING';
ALTER TYPE "DealStatus" ADD VALUE IF NOT EXISTS 'FROZEN_PENDING_RELEASE';

-- ── Financing checkpoints (§12b) ────────────────────────────────────────────────────────────────
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'NOT_STARTED';
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'TERMS_LOCKED';
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "FinancingStatus" ADD VALUE IF NOT EXISTS 'NOT_REQUIRED_CASH';

-- ── Insurance review states (§15; FAILED retained for history, §13-D7) ──────────────────────────
ALTER TYPE "InsuranceStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "InsuranceStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "InsuranceStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- ── Exception queue categories (§26; the 48 rows need these beyond the 8 existing labels) ───────
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'PAYMENT_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'SOURCING_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'AUCTION_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'OFFER_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'DEAL_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'FINANCING_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'COMMS_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'INVENTORY_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'DEALER_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'PLAN_EXCEPTION';
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'POST_COMPLETION_EXCEPTION';

-- ── Pickup outcomes (§17) ───────────────────────────────────────────────────────────────────────
ALTER TYPE "PickupStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
ALTER TYPE "PickupStatus" ADD VALUE IF NOT EXISTS 'RELEASED';

-- ── Financing audit trail (§12c; the hash chain itself is unchanged, §13-D19) ───────────────────
ALTER TYPE "FinancingAuditEventType" ADD VALUE IF NOT EXISTS 'TERMS_LOCKED';
ALTER TYPE "FinancingAuditEventType" ADD VALUE IF NOT EXISTS 'FINANCING_COMPLETED';
ALTER TYPE "FinancingAuditEventType" ADD VALUE IF NOT EXISTS 'FINANCING_FAILED';
ALTER TYPE "FinancingAuditEventType" ADD VALUE IF NOT EXISTS 'FINANCING_EXPIRED';
ALTER TYPE "FinancingAuditEventType" ADD VALUE IF NOT EXISTS 'CASH_CONFIRMED';
ALTER TYPE "FinancingAuditEventType" ADD VALUE IF NOT EXISTS 'EVIDENCE_ATTACHED';

-- ── Legacy-path instrumentation (master rule 7). `audit_logs.action` is this enum, not text, so
--    the label must be committed here before directory 2 can name it in an index predicate. ──────
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'LEGACY_PATH_WRITE';

-- ── OWNER-GATED (§13-D39). One statement, omittable without reordering anything else. ───────────
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'NOT_SELECTED';
