-- Rollback for 20261117000300.
--
-- REFUSES while any LIVE invited-signer token exists. Dropping the columns invalidates every
-- outstanding co-buyer signing link silently: the co-buyer's next click resolves nothing, and
-- the deal returns to the deadlock this migration was authorised to end. A CONSUMED token is
-- spent evidence and blocks nothing, so it is not counted — only live ones.
DO $$
DECLARE
  live_tokens BIGINT;
BEGIN
  SELECT count(*) INTO live_tokens
  FROM "e_sign_envelopes"
  WHERE "signer_access_token_hash" IS NOT NULL
    AND "signer_access_token_consumed_at" IS NULL
    AND ("signer_access_token_expires_at" IS NULL OR "signer_access_token_expires_at" > now());

  IF live_tokens > 0 THEN
    RAISE EXCEPTION
      'REFUSING to roll back 20261117000300: % live co-buyer signing links would be silently invalidated, returning those deals to the SIGNING_PENDING deadlock. Void the envelopes first, or wait for the tokens to expire.',
      live_tokens;
  END IF;
END $$;

DROP INDEX IF EXISTS "e_sign_envelopes_live_signer_token_idx";
DROP INDEX IF EXISTS "e_sign_envelopes_signer_access_token_hash_key";
ALTER TABLE "e_sign_envelopes" DROP COLUMN IF EXISTS "signer_access_token_consumed_at";
ALTER TABLE "e_sign_envelopes" DROP COLUMN IF EXISTS "signer_access_token_expires_at";
ALTER TABLE "e_sign_envelopes" DROP COLUMN IF EXISTS "signer_access_token_hash";
