-- migrations/06_add_contact_lead_score.sql
-- Sortable lead score on the CRM contacts plane so /score works for ALL contacts
-- (not just buyers) and the redesigned Leads/Segments UI can rank + filter by it.
-- Apply to prod ref aieybibvewmvrubcpthm ONLY. Raw Supabase table — no Prisma migration.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score       INT,
  ADD COLUMN IF NOT EXISTS lead_temperature TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_score
  ON contacts(lead_score DESC) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lead_temperature_chk'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_lead_temperature_chk
      CHECK (lead_temperature IS NULL OR lead_temperature IN ('hot','warm','cold'));
  END IF;
END $$;
