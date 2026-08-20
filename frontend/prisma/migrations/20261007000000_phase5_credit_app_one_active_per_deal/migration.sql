-- Phase 5 — one active credit application per deal (idempotency guard).
--
-- Additive. Adds a partial-unique index so a deal can have at most ONE credit
-- application that is not WITHDRAWN. This makes the buyer `apply` route idempotent
-- against double-clicks / client retries / retry-after-500: the second insert
-- collides (P2002) and the service surfaces a conflict instead of creating a
-- duplicate SUBMITTED application. A buyer may re-apply only after the prior
-- application is explicitly WITHDRAWN. (Partial unique — Prisma cannot express it,
-- so it lives here, mirroring the B4 one-open-per-app-type index.)
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--
-- Rollback:
--   DROP INDEX IF EXISTS "credit_applications_one_active_per_deal";

CREATE UNIQUE INDEX IF NOT EXISTS "credit_applications_one_active_per_deal"
  ON "credit_applications"("deal_id")
  WHERE "status" <> 'WITHDRAWN';
