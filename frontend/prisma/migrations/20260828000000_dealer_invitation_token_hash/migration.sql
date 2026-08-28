-- Dealer invitation tokens: hash at rest, single-use, 7-day TTL.
--
-- STATUS: WRITTEN, NOT APPLIED. This migration awaits owner approval and has NOT
-- been run against any environment. Apply to staging first, verify the counts in
-- the verification block below, then production.
--
-- WHY: dealer_invitations.token was stored and looked up in PLAINTEXT, unlike
-- DealerAccountClaimToken which stores only a SHA-256 hash. A database leak was
-- therefore directly replayable into dealer account creation. There was also no
-- consumed_at, so single use was not structurally enforced.
--
-- THIS MIGRATION IS ADDITIVE AND REVERSIBLE. The plaintext `token` column is
-- deliberately KEPT here so that invitation links already sitting in dealers'
-- inboxes continue to resolve: the raw token in such a link hashes to exactly
-- the value backfilled below. Dropping `token` is a SEPARATE, LATER migration
-- (see the end of this file) to be run only after this one is verified in
-- production.

-- pgcrypto provides digest() for the backfill.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Additive columns.
ALTER TABLE "dealer_invitations"
  ADD COLUMN IF NOT EXISTS "token_hash"  TEXT,
  ADD COLUMN IF NOT EXISTS "consumed_at" TIMESTAMP(3);

-- 2. Backfill the hash from the existing plaintext token. Every live emailed
--    link keeps working because hash(raw) == the value stored here.
UPDATE "dealer_invitations"
   SET "token_hash" = encode(digest("token", 'sha256'), 'hex')
 WHERE "token" IS NOT NULL
   AND "token_hash" IS NULL;

-- 3. Backfill single-use state from the existing accepted timestamp, so an
--    already-accepted invitation cannot be replayed after this deploys.
UPDATE "dealer_invitations"
   SET "consumed_at" = "accepted_at"
 WHERE "status" = 'ACCEPTED'
   AND "accepted_at" IS NOT NULL
   AND "consumed_at" IS NULL;

-- 4. Enforce uniqueness + index the new lookup key.
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_invitations_token_hash_key"
  ON "dealer_invitations" ("token_hash");
CREATE INDEX IF NOT EXISTS "dealer_invitations_token_hash_idx"
  ON "dealer_invitations" ("token_hash");

-- 5. `token` becomes nullable — new rows write only the hash.
ALTER TABLE "dealer_invitations" ALTER COLUMN "token" DROP NOT NULL;

-- ── VERIFICATION (run after applying; all three must hold) ───────────────────
--   -- every row with a token has a hash:
--   SELECT count(*) FROM dealer_invitations WHERE token IS NOT NULL AND token_hash IS NULL;
--     -> expected 0
--   -- every accepted row is marked consumed:
--   SELECT count(*) FROM dealer_invitations WHERE status='ACCEPTED' AND accepted_at IS NOT NULL AND consumed_at IS NULL;
--     -> expected 0
--   -- hashes are unique:
--   SELECT count(*) FROM (SELECT token_hash FROM dealer_invitations WHERE token_hash IS NOT NULL
--                         GROUP BY 1 HAVING count(*) > 1) d;
--     -> expected 0

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS "dealer_invitations_token_hash_idx";
--   DROP INDEX IF EXISTS "dealer_invitations_token_hash_key";
--   ALTER TABLE "dealer_invitations" DROP COLUMN IF EXISTS "consumed_at";
--   ALTER TABLE "dealer_invitations" DROP COLUMN IF EXISTS "token_hash";
--   ALTER TABLE "dealer_invitations" ALTER COLUMN "token" SET NOT NULL;
--   (safe: nothing above destroys existing data)

-- ── FOLLOW-UP MIGRATION, DO NOT INCLUDE HERE ────────────────────────────────
--   Once this is verified in production and no plaintext lookups remain:
--     DROP INDEX IF EXISTS "dealer_invitations_token_idx";
--     ALTER TABLE "dealer_invitations" DROP COLUMN "token";
--
-- ── SEPARATE DATA-HYGIENE ITEM, OWNER APPROVAL REQUIRED ──────────────────────
--   3 ACCEPTED rows reference dealer_ids that no longer exist. They are consent
--   evidence and must NOT be deleted; null the dangling pointer instead:
--     UPDATE dealer_invitations i SET dealer_id = NULL
--      WHERE i.status='ACCEPTED' AND i.dealer_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM dealers d WHERE d.id = i.dealer_id);
