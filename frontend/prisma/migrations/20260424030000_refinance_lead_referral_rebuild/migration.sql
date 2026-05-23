-- Migration: refinance_lead_referral_rebuild
-- Rebuilds the refinance data model as a lead-referral flow to OpenRoad Lending.
-- AutoLenis does NOT make lending decisions; this migration removes all fields and
-- models that implied internal loan processing (partners table, analytics table, etc.)
-- and replaces them with a lead-tracking schema with compliance audit fields.

-- Dev-only: clear any prior refinance records. No production data yet.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_compliance_logs')) IS NOT NULL THEN
    DELETE FROM "refinance_compliance_logs";
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    DELETE FROM "refinance_applications";
  END IF;
END $$;

-- Drop removed tables (partner registry + partner analytics)
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_partner_analytics')) IS NOT NULL THEN
    DROP TABLE IF EXISTS "refinance_partner_analytics";
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_partners')) IS NOT NULL THEN
    DROP TABLE IF EXISTS "refinance_partners";
  END IF;
END $$;

-- Drop columns that implied internal lending logic
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications"
      DROP COLUMN IF EXISTS "vehicle_make",
      DROP COLUMN IF EXISTS "vehicle_model",
      DROP COLUMN IF EXISTS "current_rate_apr",
      DROP COLUMN IF EXISTS "months_remaining",
      DROP COLUMN IF EXISTS "estimated_credit_score",
      DROP COLUMN IF EXISTS "email_address",
      DROP COLUMN IF EXISTS "tcpa_consent",
      DROP COLUMN IF EXISTS "partner_id";
  END IF;
END $$;

-- Recreate the RefinanceStatus enum with lead-referral values only
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ALTER COLUMN "status" DROP DEFAULT;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ALTER COLUMN "status" TYPE TEXT USING status::TEXT;
  END IF;
END $$;
DROP TYPE IF EXISTS "RefinanceStatus";
CREATE TYPE "RefinanceStatus" AS ENUM ('SUBMITTED', 'QUALIFIED', 'INELIGIBLE', 'REDIRECTED', 'EXCLUDED_STATE');
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications"
      ALTER COLUMN "status" TYPE "RefinanceStatus" USING (
        CASE status
          WHEN 'SUBMITTED' THEN 'SUBMITTED'::"RefinanceStatus"
          WHEN 'REDIRECTED' THEN 'REDIRECTED'::"RefinanceStatus"
          ELSE 'SUBMITTED'::"RefinanceStatus"
        END
      );
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
  END IF;
END $$;

-- Add new columns. Since the table was cleared, safe to mark NOT NULL and drop defaults after.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications"
      ADD COLUMN "lead_id"                 TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "first_name"              TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "last_name"               TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "email"                   TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "phone"                   TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "monthly_payment_cents"   INTEGER          NOT NULL DEFAULT 0,
      ADD COLUMN "interest_rate_band"      TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "employment_status"       TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "state"                   TEXT             NOT NULL DEFAULT '',
      ADD COLUMN "consent_given"           BOOLEAN          NOT NULL DEFAULT false,
      ADD COLUMN "consent_timestamp"       TIMESTAMP(3),
      ADD COLUMN "ip_hash"                 TEXT,
      ADD COLUMN "source"                  TEXT;
  END IF;
END $$;

-- vehicle_year was nullable; the new spec requires it. Backfill to 0 where NULL, then enforce NOT NULL.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    UPDATE "refinance_applications" SET "vehicle_year" = COALESCE("vehicle_year", 0);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ALTER COLUMN "vehicle_year" SET NOT NULL;
  END IF;
END $$;

-- Same for loan_balance_cents
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    UPDATE "refinance_applications" SET "loan_balance_cents" = COALESCE("loan_balance_cents", 0);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ALTER COLUMN "loan_balance_cents" SET NOT NULL;
  END IF;
END $$;

-- Drop empty-string defaults (new rows must supply these; empties were only a transitional backfill)
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications"
      ALTER COLUMN "lead_id"                DROP DEFAULT,
      ALTER COLUMN "first_name"             DROP DEFAULT,
      ALTER COLUMN "last_name"              DROP DEFAULT,
      ALTER COLUMN "email"                  DROP DEFAULT,
      ALTER COLUMN "phone"                  DROP DEFAULT,
      ALTER COLUMN "monthly_payment_cents"  DROP DEFAULT,
      ALTER COLUMN "interest_rate_band"     DROP DEFAULT,
      ALTER COLUMN "employment_status"      DROP DEFAULT,
      ALTER COLUMN "state"                  DROP DEFAULT,
      ALTER COLUMN "consent_given"          SET DEFAULT false;
  END IF;
END $$;

-- Unique index on lead_id (used as OpenRoad subid)
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "refinance_applications_lead_id_key" ON "refinance_applications"("lead_id");
  END IF;
END $$;

-- Query indexes
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    CREATE INDEX "refinance_applications_status_idx"     ON "refinance_applications"("status");
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    CREATE INDEX "refinance_applications_state_idx"      ON "refinance_applications"("state");
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    CREATE INDEX "refinance_applications_created_at_idx" ON "refinance_applications"("created_at");
  END IF;
END $$;
