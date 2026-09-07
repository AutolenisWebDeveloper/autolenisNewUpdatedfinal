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

-- ── Exception queue categories (§13-D11 option A: broad categories, the §26 row identity carried in
--    TEXT `queue_items.exception_code`). TWELVE additive labels on top of production's 8, so
--    `QueueItemType` holds 20 afterwards (R36). Eleven come from the §26 register's 48 rows; the
--    twelfth, LINEAGE_ORPHAN, does not — see its own note below. ─────────────────────────────────
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
-- §13-D11 shape correction 5. LINEAGE_ORPHAN is required by L3-01 (the §3 "one lineage, never broken"
-- rule for the five non-payment record classes) and is covered by NO §26 register row, which is why
-- an enumeration derived from §26 alone missed it. Phase 2 writes it from `assertParentResolvable()`
-- in `lib/services/operations/queue-item.service.ts`; Phase 1 owes only the label.
ALTER TYPE "QueueItemType" ADD VALUE IF NOT EXISTS 'LINEAGE_ORPHAN';

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

-- ── §13-D39 — OMITTED FROM THIS WAVE BY OWNER DECISION (Phase 1 STOP 1) ────────────────────────
-- `OfferStatus.NOT_SELECTED` is deliberately NOT added here. §13-D39 is unruled, and an enum label
-- is the one object in this wave that cannot be taken back: PostgreSQL has no DROP VALUE, so a
-- label added on an unruled decision is permanent, while a label withheld can be added by any later
-- migration. The two rows that would consume it are both Phase 6 and both name an alternative that
-- already exists — S4 (WF:2545) writes "`DECLINED` (or `NOT_SELECTED`)" and O1 (WF:2581) reads the
-- bidder query. Neither is blocked by the omission. If D39 is later ruled in favour of the distinct
-- label, Phase 6 adds it in its own directory alongside `auctions.relaunched_at`/`relaunch_count`,
-- so the decision lands whole rather than half-landed here.
--
-- Directory 2 names no OfferStatus label, so nothing in this wave depends on it.
