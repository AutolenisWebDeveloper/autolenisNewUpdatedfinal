-- Program 6 (durability correction) — the durable ActionIntent lifecycle table.
--
-- OWNER APPROVAL REQUIRED: this migration is authored but NOT applied. It adds
-- ONE new table (ai_action_intents) + ONE new enum (AiActionIntentStatus). It
-- creates no FK to and alters no existing table, so it cannot corrupt existing
-- data. Apply with `prisma migrate deploy` only after review.
--
-- Capability-absence proof: no existing model can durably hold the mutable
-- 7-state proposal->execution lifecycle. AuditLog/AdminAuditLog are append-only
-- (UPDATE/DELETE blocked by trigger); FinancingReviewTask (OPEN/IN_PROGRESS/
-- RESOLVED, required credit_application_id FK), BuyerOfferReview (required
-- vehicle_offer_id FK) and ExternalPreApproval (required buyer_id FK) are all
-- domain-bound with 3-state review enums.
--
-- Idempotent: guarded with IF NOT EXISTS / to_regclass / pg_type checks so a
-- re-run is a no-op. RLS is enabled with no policy => deny-all for anon and
-- authenticated (all access is server-side via the Prisma owner connection or
-- the service-role key), matching every other table in this schema.

-- 1. Enum (CREATE TYPE has no IF NOT EXISTS — guard on pg_type).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiActionIntentStatus') THEN
    CREATE TYPE "AiActionIntentStatus" AS ENUM (
      'PROPOSED', 'APPROVAL_REQUIRED', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMPLETED', 'FAILED'
    );
  END IF;
END
$$;

-- 2. Table.
CREATE TABLE IF NOT EXISTS "ai_action_intents" (
  "id"                       TEXT NOT NULL,
  "intent_type"              TEXT NOT NULL,
  "status"                   "AiActionIntentStatus" NOT NULL DEFAULT 'PROPOSED',
  "actor_type"               TEXT NOT NULL,
  "actor_id"                 TEXT NOT NULL,
  "authenticated_role"       TEXT NOT NULL,
  "subject_id"               TEXT,
  "parameters"               JSONB NOT NULL,
  "consequence"              TEXT NOT NULL,
  "requires_human_approval"  BOOLEAN NOT NULL,
  "idempotency_key"          TEXT,
  "rationale"                TEXT,
  "policy_result"            JSONB,
  "approver_id"              TEXT,
  "approver_role"            TEXT,
  "approved_at"              TIMESTAMP(3),
  "rejected_at"              TIMESTAMP(3),
  "rejection_code"           TEXT,
  "execution_claimed_at"     TIMESTAMP(3),
  "execution_attempts"       INTEGER NOT NULL DEFAULT 0,
  "result"                   JSONB,
  "failure_reason"           TEXT,
  "completed_at"             TIMESTAMP(3),
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_action_intents_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes. The unique index on idempotency_key is the DB-enforced proposal
--    dedup (NULLs are allowed to repeat, per Postgres). The status index backs
--    the atomic execution-claim UPDATE and the pending-approval listing.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_action_intents_idempotency_key_key"
  ON "ai_action_intents" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "ai_action_intents_status_idx"
  ON "ai_action_intents" ("status");
CREATE INDEX IF NOT EXISTS "ai_action_intents_actor_type_actor_id_idx"
  ON "ai_action_intents" ("actor_type", "actor_id");
CREATE INDEX IF NOT EXISTS "ai_action_intents_status_requires_human_approval_idx"
  ON "ai_action_intents" ("status", "requires_human_approval");

-- 4. RLS: enable with no policy => deny-all for client roles. No-op if already on.
ALTER TABLE "ai_action_intents" ENABLE ROW LEVEL SECURITY;
