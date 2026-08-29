-- normalize_deal_fee_amount_net.sql
--
-- One-time, idempotent data fix. Apply deliberately (not auto-run on deploy).
--
-- Deal.feeAmountCents must store the NET concierge fee actually charged
-- ($400 = PREMIUM_FEE_REMAINING_CENTS), i.e. net of the $99 deposit credit.
--
-- Historically three recording paths stored the GROSS fee ($499 =
-- PREMIUM_FEE_CENTS):
--   • buyer self-service fee  (lib/services/deal/service-fee.service.ts)
--   • Stripe webhook          (app/api/webhooks/stripe/route.ts)
--   • admin journey complete  (app/api/admin/buyers/[buyerId]/journey/*)
-- while the admin concierge-fee create-intent / send-link path already stored
-- the correct net $400. Because revenue reports sum deposits ($99) AND fees
-- separately, the gross-recorded rows double-counted the $99 deposit and
-- overstated buyer receipts/wallets by $99.
--
-- The application code now records net $400 everywhere. This script converts
-- the historical gross rows to match. $49900 unambiguously means the gross
-- premium fee, so the WHERE clause is exact and re-running is a no-op.

UPDATE "Deal"
SET    "feeAmountCents" = 40000   -- PREMIUM_FEE_REMAINING_CENTS ($400 net)
WHERE  "feeAmountCents" = 49900   -- PREMIUM_FEE_CENTS ($499 gross)
  AND  "feePaidAt" IS NOT NULL;

-- Verification (expect 0 gross rows remaining after the update):
--   SELECT count(*) FROM "Deal" WHERE "feeAmountCents" = 49900;
