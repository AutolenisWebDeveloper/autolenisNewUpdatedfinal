-- Rollback for 20261201000000.
--
-- REFUSES while any LIVE release token exists. Dropping the unique index while two pickups could
-- then share a hash is how single use stops being enforceable; and there is no way back to the
-- cleared plaintext — the raw tokens were never stored, by design. A rollback that silently
-- leaves live tokens unenforceable is worse than no rollback, so this one stops.
--
-- A CONSUMED or REVOKED token is spent evidence and blocks nothing, so neither is counted.
DO $$
DECLARE
  live_tokens BIGINT;
BEGIN
  SELECT count(*) INTO live_tokens
  FROM "pickups"
  WHERE "token_hash" IS NOT NULL
    AND "token_consumed_at" IS NULL
    AND "token_revoked_at" IS NULL
    AND ("token_expires_at" IS NULL OR "token_expires_at" > now());

  IF live_tokens > 0 THEN
    RAISE EXCEPTION
      'REFUSING to roll back 20261201000000: % live pickup release tokens would lose their uniqueness guarantee, and the cleared qr_code_data/qr_code_image cannot be restored (the raw tokens were never stored). Revoke the outstanding tokens first, or wait for them to expire.',
      live_tokens;
  END IF;
END $$;

-- The indexes are all this migration created. The columns are the Phase 1 wave's and stay.
DROP INDEX IF EXISTS "pickups_live_release_token_idx";
DROP INDEX IF EXISTS "pickups_token_hash_key";

-- NOT REVERSIBLE, STATED PLAINLY: the UPDATE that cleared qr_code_data and qr_code_image has no
-- inverse. Those values were the plaintext credential this migration exists to remove, and the
-- raw tokens they encoded were never stored anywhere. Any pickup that needs a scannable code
-- after a rollback is re-issued through the release-token service, not restored.
