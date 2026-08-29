-- AffiliateProfile / TaxProfile / PaymentProfile / OnboardingReview.
--
-- TYPE CORRECTION: these tables originally declared "id" and "affiliate_id" as
-- postgres UUID while affiliates.id is TEXT (Prisma `String @default(uuid())`
-- maps to TEXT, not the uuid type). Postgres refuses a foreign key across that
-- type boundary with 42804 "cannot be implemented", so this migration could not
-- apply to ANY database. Column types now match schema.prisma exactly: TEXT ids
-- with no database default (Prisma generates the uuid) and TIMESTAMP(3)
-- timestamps rather than TIMESTAMPTZ.

CREATE TABLE IF NOT EXISTS "affiliate_profiles" (
  "id"               TEXT PRIMARY KEY,
  "affiliate_id"     TEXT NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "first_name"       TEXT,
  "last_name"        TEXT,
  "phone"            TEXT,
  "date_of_birth"    TEXT,
  "address_line1"    TEXT,
  "address_line2"    TEXT,
  "city"             TEXT,
  "state"            TEXT,
  "zip"              TEXT,
  "country"          TEXT DEFAULT 'US',
  "entity_type"      TEXT,
  "business_name"    TEXT,
  "dba_name"         TEXT,
  "business_address" TEXT,
  "ein_last4"        TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AffiliateTaxProfile: W-9 equivalent
CREATE TABLE IF NOT EXISTS "affiliate_tax_profiles" (
  "id"                  TEXT PRIMARY KEY,
  "affiliate_id"        TEXT NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "tax_classification"  TEXT,
  "tin_last4"           TEXT,
  "tin_type"            TEXT,
  "legal_name"          TEXT,
  "certified"           BOOLEAN DEFAULT false,
  "certified_at"        TIMESTAMP(3),
  "attestation_text"    TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AffiliatePaymentProfile: banking/payout
CREATE TABLE IF NOT EXISTS "affiliate_payment_profiles" (
  "id"               TEXT PRIMARY KEY,
  "affiliate_id"     TEXT NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "payout_method"    TEXT,
  "holder_name"      TEXT,
  "routing_last4"    TEXT,
  "account_last4"    TEXT,
  "account_type"     TEXT,
  "paypal_email"     TEXT,
  "zelle_phone"      TEXT,
  "verified"         BOOLEAN DEFAULT false,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- OnboardingStatus enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnboardingStatus') THEN
    CREATE TYPE "OnboardingStatus" AS ENUM (
  'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW',
  'NEEDS_CORRECTION', 'APPROVED', 'REJECTED'
);
  END IF;
END $$;

-- AffiliateOnboardingReview: admin review record
CREATE TABLE IF NOT EXISTS "affiliate_onboarding_reviews" (
  "id"               TEXT PRIMARY KEY,
  "affiliate_id"     TEXT NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "status"           "OnboardingStatus" DEFAULT 'NOT_STARTED',
  "current_step"     INTEGER DEFAULT 1,
  "submitted_at"     TIMESTAMP(3),
  "reviewed_at"      TIMESTAMP(3),
  "reviewed_by"      TEXT,
  "decision_note"    TEXT,
  "internal_notes"   TEXT,
  "correction_items" TEXT[],
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
