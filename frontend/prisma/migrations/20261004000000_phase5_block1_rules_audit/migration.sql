-- Phase 5 Block 1 — rule-injection layer + tamper-evident audit trail.
--
-- Additive + idempotent. Two new tables, both RLS deny-all (server-only access via
-- Prisma/service-role). financing_audit_events is append-only at the DB level
-- (block UPDATE/DELETE trigger, mirroring admin_audit_logs) and carries a
-- prev_hash→hash chain so tampering is detectable. compliance_rules holds the
-- INJECTED regulatory content — EMPTY BY DEFAULT; a partial-unique index enforces
-- at most one ACTIVE row per rule_type.
--
-- No regulatory content is created here — only the empty slots + the engine that
-- fails closed when a slot is unpopulated.
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--    The Vercel build does NOT run migrations. Additive/nullable-first; no FK is
--    made required in this migration.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS financing_audit_events_no_update ON "financing_audit_events";
--   DROP TRIGGER IF EXISTS financing_audit_events_no_delete ON "financing_audit_events";
--   DROP TRIGGER IF EXISTS financing_audit_events_no_truncate ON "financing_audit_events";
--   DROP FUNCTION IF EXISTS financing_audit_events_block_update();
--   DROP FUNCTION IF EXISTS financing_audit_events_block_delete();
--   DROP FUNCTION IF EXISTS financing_audit_events_block_truncate();
--   DROP TABLE IF EXISTS "financing_audit_events";
--   DROP TABLE IF EXISTS "compliance_rules";
--   DROP TYPE IF EXISTS "FinancingAuditEventType";
--   DROP TYPE IF EXISTS "FinancingAuditActorType";
--   DROP TYPE IF EXISTS "ComplianceRuleStatus";
--   DROP TYPE IF EXISTS "ComplianceRuleType";

DO $$ BEGIN CREATE TYPE "ComplianceRuleType" AS ENUM ('ADVERSE_ACTION_TRIGGER','ADVERSE_ACTION_NOTICE','TILA_DISCLOSURE','FCRA_CONSENT','FCRA_RETENTION','FAIR_LENDING_BOUNDARY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ComplianceRuleStatus" AS ENUM ('DRAFT','ACTIVE','RETIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FinancingAuditActorType" AS ENUM ('SYSTEM','ADMIN','BUYER','LENDER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FinancingAuditEventType" AS ENUM ('APPLICATION_SUBMITTED','ADAPTER_CALL','DECISION_RENDERED','NOTICE_GENERATED','NOTICE_SENT','RULE_APPLIED','RULE_ABSENT_FAIL_CLOSED','HUMAN_OVERRIDE','STATE_TRANSITION','REVIEW_ROUTED','REVIEW_RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "compliance_rules" (
  "id"            TEXT NOT NULL,
  "rule_type"     "ComplianceRuleType" NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 1,
  "status"        "ComplianceRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "content"       JSONB,
  "template_body" TEXT,
  "source"        TEXT,
  "effective_at"  TIMESTAMP(3),
  "created_by"    TEXT,
  "activated_by"  TEXT,
  "activated_at"  TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_rules_rule_type_version_key" ON "compliance_rules"("rule_type","version");
CREATE INDEX IF NOT EXISTS "compliance_rules_rule_type_status_idx" ON "compliance_rules"("rule_type","status");
-- At most ONE active rule per type (partial unique — Prisma cannot express this).
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_rules_one_active_per_type" ON "compliance_rules"("rule_type") WHERE "status" = 'ACTIVE';
ALTER TABLE "compliance_rules" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "financing_audit_events" (
  "id"                    TEXT NOT NULL,
  "sequence"              INTEGER NOT NULL,
  "event_type"            "FinancingAuditEventType" NOT NULL,
  "actor_type"            "FinancingAuditActorType" NOT NULL,
  "actor_id"              TEXT,
  "credit_application_id" TEXT,
  "deal_id"               TEXT,
  "buyer_id"              TEXT,
  "rule_id"               TEXT,
  "payload"               JSONB NOT NULL,
  "prev_hash"             TEXT,
  "hash"                  TEXT NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financing_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "financing_audit_events_sequence_key" ON "financing_audit_events"("sequence");
CREATE INDEX IF NOT EXISTS "financing_audit_events_credit_application_id_idx" ON "financing_audit_events"("credit_application_id");
CREATE INDEX IF NOT EXISTS "financing_audit_events_deal_id_idx" ON "financing_audit_events"("deal_id");
CREATE INDEX IF NOT EXISTS "financing_audit_events_event_type_idx" ON "financing_audit_events"("event_type");
ALTER TABLE "financing_audit_events" ENABLE ROW LEVEL SECURITY;

-- Append-only: the only legal write is INSERT. UPDATE/DELETE raise (mirrors the
-- admin_audit_logs trigger). Correct a mistake by appending a corrective event.
CREATE OR REPLACE FUNCTION financing_audit_events_block_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'financing_audit_events is append-only — UPDATE is not permitted (row id=%)', OLD.id
    USING ERRCODE = 'restrict_violation', HINT = 'Append a corrective event instead. The audit chain must stay immutable.';
END; $fn$;
CREATE OR REPLACE FUNCTION financing_audit_events_block_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'financing_audit_events is append-only — DELETE is not permitted (row id=%)', OLD.id
    USING ERRCODE = 'restrict_violation', HINT = 'Audit rows must never be deleted.';
END; $fn$;
-- TRUNCATE bypasses row-level triggers, so it gets its own statement-level guard —
-- otherwise the whole chain could be wiped without tripping the row triggers.
CREATE OR REPLACE FUNCTION financing_audit_events_block_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'financing_audit_events is append-only — TRUNCATE is not permitted'
    USING ERRCODE = 'restrict_violation', HINT = 'The audit chain must never be truncated.';
END; $fn$;
DROP TRIGGER IF EXISTS financing_audit_events_no_update ON "financing_audit_events";
DROP TRIGGER IF EXISTS financing_audit_events_no_delete ON "financing_audit_events";
DROP TRIGGER IF EXISTS financing_audit_events_no_truncate ON "financing_audit_events";
CREATE TRIGGER financing_audit_events_no_update BEFORE UPDATE ON "financing_audit_events" FOR EACH ROW EXECUTE FUNCTION financing_audit_events_block_update();
CREATE TRIGGER financing_audit_events_no_delete BEFORE DELETE ON "financing_audit_events" FOR EACH ROW EXECUTE FUNCTION financing_audit_events_block_delete();
CREATE TRIGGER financing_audit_events_no_truncate BEFORE TRUNCATE ON "financing_audit_events" FOR EACH STATEMENT EXECUTE FUNCTION financing_audit_events_block_truncate();
