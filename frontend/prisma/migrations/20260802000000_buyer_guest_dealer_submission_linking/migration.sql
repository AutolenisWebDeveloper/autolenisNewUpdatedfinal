-- AlterTable
ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "is_guest" BOOLEAN NOT NULL DEFAULT FALSE;

-- AlterTable
ALTER TABLE "dealer_offer_submissions"
  ADD COLUMN IF NOT EXISTS "dealer_id" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealer_offer_submissions_dealer_id_fkey'
  ) THEN
    ALTER TABLE "dealer_offer_submissions"
      ADD CONSTRAINT "dealer_offer_submissions_dealer_id_fkey"
      FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dealer_offer_submissions_dealer_id_idx" ON "dealer_offer_submissions"("dealer_id");
