-- Migration: refinance_buyerid_nullable
-- Makes buyer_id optional on refinance_applications to support anonymous public form submissions.
-- Previously: buyer_id was NOT NULL with a foreign key to buyers.id
-- After:      buyer_id is nullable; anonymous submissions store NULL.

ALTER TABLE "refinance_applications" ALTER COLUMN "buyer_id" DROP NOT NULL;
