-- AffiliateProfile: personal + business info
CREATE TABLE "affiliate_profiles" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "affiliate_id"     UUID NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
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
  "created_at"       TIMESTAMPTZ DEFAULT now(),
  "updated_at"       TIMESTAMPTZ DEFAULT now()
);

-- AffiliateTaxProfile: W-9 equivalent
CREATE TABLE "affiliate_tax_profiles" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "affiliate_id"        UUID NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "tax_classification"  TEXT,
  "tin_last4"           TEXT,
  "tin_type"            TEXT,
  "legal_name"          TEXT,
  "certified"           BOOLEAN DEFAULT false,
  "certified_at"        TIMESTAMPTZ,
  "attestation_text"    TEXT,
  "created_at"          TIMESTAMPTZ DEFAULT now(),
  "updated_at"          TIMESTAMPTZ DEFAULT now()
);

-- AffiliatePaymentProfile: banking/payout
CREATE TABLE "affiliate_payment_profiles" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "affiliate_id"     UUID NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "payout_method"    TEXT,
  "holder_name"      TEXT,
  "routing_last4"    TEXT,
  "account_last4"    TEXT,
  "account_type"     TEXT,
  "paypal_email"     TEXT,
  "zelle_phone"      TEXT,
  "verified"         BOOLEAN DEFAULT false,
  "created_at"       TIMESTAMPTZ DEFAULT now(),
  "updated_at"       TIMESTAMPTZ DEFAULT now()
);

-- OnboardingStatus enum
CREATE TYPE "OnboardingStatus" AS ENUM (
  'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW',
  'NEEDS_CORRECTION', 'APPROVED', 'REJECTED'
);

-- AffiliateOnboardingReview: admin review record
CREATE TABLE "affiliate_onboarding_reviews" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "affiliate_id"     UUID NOT NULL UNIQUE REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "status"           "OnboardingStatus" DEFAULT 'NOT_STARTED',
  "current_step"     INTEGER DEFAULT 1,
  "submitted_at"     TIMESTAMPTZ,
  "reviewed_at"      TIMESTAMPTZ,
  "reviewed_by"      TEXT,
  "decision_note"    TEXT,
  "internal_notes"   TEXT,
  "correction_items" TEXT[],
  "created_at"       TIMESTAMPTZ DEFAULT now(),
  "updated_at"       TIMESTAMPTZ DEFAULT now()
);
