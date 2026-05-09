-- Migration: add_compliance_events
-- Adds ComplianceEvent table to record FCRA/regulatory audit events
-- (e.g. ADVERSE_ACTION_NOTICE_SENT under FCRA § 615).

CREATE TABLE IF NOT EXISTS "compliance_events" (
  "id"                     TEXT         NOT NULL,
  "event_type"             TEXT         NOT NULL,
  "buyer_id"               TEXT         NOT NULL,
  "prequal_application_id" TEXT,
  "metadata"               JSONB,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "compliance_events_buyer_id_created_at_idx"
  ON "compliance_events"("buyer_id", "created_at");
CREATE INDEX IF NOT EXISTS "compliance_events_event_type_idx"
  ON "compliance_events"("event_type");

ALTER TABLE "compliance_events"
  ADD CONSTRAINT "compliance_events_buyer_id_fkey"
  FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compliance_events"
  ADD CONSTRAINT "compliance_events_prequal_application_id_fkey"
  FOREIGN KEY ("prequal_application_id") REFERENCES "pre_qualifications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
