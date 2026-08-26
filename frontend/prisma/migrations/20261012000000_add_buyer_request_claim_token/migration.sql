-- $99 pre-checkout conversion — secure request-resume/claim token.
--
-- Additive + defensive (IF NOT EXISTS, no destructive op). Production's Prisma
-- ledger is known to drift from the repo, so the guards make this safe to apply
-- even if the table/indexes were added out of band. DORMANT until the owner-gated
-- pre-checkout cutover: nothing mints a token until PRECHECKOUT_CONVERSION_INTERNAL_ENABLED
-- routes enrollment to the internal lifecycle path.
--
-- Only the SHA-256 hash of the raw token is stored; the raw token exists solely in
-- the emailed resume link, so a DB leak cannot reconstruct a usable link. The token
-- is a deep-link only (no authenticated capability); the buyer's Supabase session
-- remains the real access boundary at /buyer/deposit.

CREATE TABLE IF NOT EXISTS "buyer_request_claim_tokens" (
  "id"                 TEXT NOT NULL,
  "token_hash"         TEXT NOT NULL,
  "buyer_id"           TEXT NOT NULL,
  "vehicle_request_id" TEXT,
  "expires_at"         TIMESTAMP(3) NOT NULL,
  "consumed_at"        TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buyer_request_claim_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "buyer_request_claim_tokens_token_hash_key"
  ON "buyer_request_claim_tokens" ("token_hash");

CREATE INDEX IF NOT EXISTS "buyer_request_claim_tokens_token_hash_idx"
  ON "buyer_request_claim_tokens" ("token_hash");

CREATE INDEX IF NOT EXISTS "buyer_request_claim_tokens_buyer_id_idx"
  ON "buyer_request_claim_tokens" ("buyer_id");
