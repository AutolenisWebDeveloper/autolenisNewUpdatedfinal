-- In-house dealer agreement e-sign system.
-- One signature record per dealer (dealer_id is unique) capturing the
-- ESIGN/UETA-compliant click-wrap signature, attribution, and the path to the
-- generated certificate PDF in the private "legal-documents" storage bucket.
--
-- Idempotent: guarded with IF NOT EXISTS / pg_constraint checks. On
-- environments where the table was already provisioned under the earlier
-- "20260607000000_add_dealer_agreement_signature" migration name (the migration
-- was renamed in the repo but the live ledger still records the old name),
-- this migration is a safe no-op.

-- CreateTable
CREATE TABLE IF NOT EXISTS "dealer_agreement_signatures" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "agreement_version" TEXT NOT NULL,
    "agreement_hash" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT NOT NULL,
    "dealership_name" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consented_to_electronic" BOOLEAN NOT NULL DEFAULT true,
    "certificate_pdf_path" TEXT,
    "certificate_generated_at" TIMESTAMP(3),
    "confirmation_email_sent_at" TIMESTAMP(3),
    "confirmation_email_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_agreement_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_agreement_signatures_dealer_id_key" ON "dealer_agreement_signatures"("dealer_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dealer_agreement_signatures_agreement_version_idx" ON "dealer_agreement_signatures"("agreement_version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dealer_agreement_signatures_signed_at_idx" ON "dealer_agreement_signatures"("signed_at");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealer_agreement_signatures_dealer_id_fkey'
  ) THEN
    ALTER TABLE "dealer_agreement_signatures" ADD CONSTRAINT "dealer_agreement_signatures_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
