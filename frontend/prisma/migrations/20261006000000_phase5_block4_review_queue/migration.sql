-- Phase 5 Block 4 — human-in-the-loop financing review queue.
--
-- Additive. New table financing_review_tasks + two enums. RLS deny-all
-- (server-only). FK on this NEW table → credit_applications (CASCADE).
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--
-- Rollback:
--   DROP TABLE IF EXISTS "financing_review_tasks";
--   DROP TYPE IF EXISTS "FinancingReviewTaskStatus";
--   DROP TYPE IF EXISTS "FinancingReviewTaskType";

DO $$ BEGIN CREATE TYPE "FinancingReviewTaskType" AS ENUM ('STIP_REVIEW','ADVERSE_ACTION_REVIEW','EDGE_DECLINE_REVIEW','LENDER_FAILURE_REVIEW','MANUAL_DECISION_REVIEW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FinancingReviewTaskStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "financing_review_tasks" (
  "id"                    TEXT NOT NULL,
  "credit_application_id" TEXT NOT NULL,
  "deal_id"               TEXT,
  "buyer_id"              TEXT,
  "task_type"             "FinancingReviewTaskType" NOT NULL,
  "status"                "FinancingReviewTaskStatus" NOT NULL DEFAULT 'OPEN',
  "reason"                TEXT,
  "assigned_admin_id"     TEXT,
  "resolution"            TEXT,
  "resolution_outcome"    TEXT,
  "resolved_by"           TEXT,
  "resolved_at"           TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financing_review_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "financing_review_tasks_status_task_type_idx" ON "financing_review_tasks"("status","task_type");
CREATE INDEX IF NOT EXISTS "financing_review_tasks_credit_application_id_idx" ON "financing_review_tasks"("credit_application_id");
-- Idempotency at the DB level: at most one OPEN/IN_PROGRESS task per (application,
-- type). routeToReview catches the P2002 collision and returns the winner, so
-- concurrent routes cannot duplicate. (Partial unique — Prisma cannot express it.)
CREATE UNIQUE INDEX IF NOT EXISTS "financing_review_tasks_one_open_per_app_type"
  ON "financing_review_tasks"("credit_application_id","task_type")
  WHERE "status" IN ('OPEN','IN_PROGRESS');

DO $$ BEGIN
  ALTER TABLE "financing_review_tasks" ADD CONSTRAINT "financing_review_tasks_credit_application_id_fkey"
    FOREIGN KEY ("credit_application_id") REFERENCES "credit_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "financing_review_tasks" ENABLE ROW LEVEL SECURITY;
