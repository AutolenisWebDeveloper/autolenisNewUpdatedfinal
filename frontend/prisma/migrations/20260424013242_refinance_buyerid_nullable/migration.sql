-- Migration: refinance_buyerid_nullable
-- Makes buyer_id optional on refinance_applications to support anonymous public form submissions.
-- Previously: buyer_id was NOT NULL with a foreign key to buyers.id
-- After:      buyer_id is nullable; anonymous submissions store NULL.

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ALTER COLUMN "buyer_id" DROP NOT NULL;
  END IF;
END $$;
