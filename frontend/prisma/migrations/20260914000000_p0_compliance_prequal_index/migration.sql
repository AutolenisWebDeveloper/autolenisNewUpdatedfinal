-- Migration: p0_compliance_prequal_index (P0-1 schema/migration drift reconciliation)
-- Registers the compliance_events(prequal_application_id) index that exists in
-- schema.prisma (@@index([prequalApplicationId])) but was never created by a
-- migration. Idempotent — safe to re-run and safe if the index already exists
-- in production (e.g. from a prior `db push`).
CREATE INDEX IF NOT EXISTS "compliance_events_prequal_application_id_idx"
  ON "compliance_events" ("prequal_application_id");
