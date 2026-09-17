-- Phase 9 — the pickup RELEASE TOKEN: hash at rest, single-use, expiry bound to the appointment.
--
-- STATUS: AUTHORED, NOT APPLIED. Applying it is the owner's, per run, under CLAUDE.md's
-- production-database protocol.
--
-- WHY. `pickups.qr_code_data` stored the release credential in PLAINTEXT and the dealer scan
-- looked it up by equality (`where: { qrCodeData: qrToken }`). Both QR generators seeded their
-- nonce from `Math.random()` (`qr.service.ts:5`, `pickup.service.ts:16`), which is not a CSPRNG,
-- so the token was guessable as well as readable. There was no `consumed_at`, so single use was
-- not structurally enforced, and `regenerateQr` minted a live 48-hour token for a pickup in ANY
-- state — including one never confirmed.
--
-- The four columns this token needs already exist: `token_hash`, `token_expires_at`,
-- `token_consumed_at` and `token_revoked_at` arrived with the Phase 1 wave
-- (20261106000100_transaction_spine_foundation) and have never had a writer. This migration adds
-- the two indexes they need and clears the legacy plaintext.
--
-- WHY THE CLEARING IS NOT CLEANUP. `qr_code_image` is `QRCode.toDataURL(rawPayload)` — the stored
-- PNG decodes back to the raw token. Keeping it beside `token_hash` passes every test the change
-- names while leaving a database read that still yields a working credential. That is not
-- hash-at-rest; it is the appearance of it. Owner ruling, 2026-09-16: same change, or the hashing
-- is theatre. `qr_code_data` goes with it for the same reason.
--
-- THE BACKFILL IS EMPTY, AND IS STILL A BACKFILL. `pickups` holds zero rows in production today.
-- The UPDATE below is written as though it did not: it is the statement that would clear a live
-- credential, and it is correct whether it touches nought rows or ten thousand. An empty backfill
-- omitted is a backfill that was never written; an empty backfill run is one that is proven.
--
-- NO TOKEN IS BACKFILLED INTO token_hash, DELIBERATELY. The dealer-invitation precedent
-- (20260828000000) hashed its plaintext forward so live emailed links kept working. The opposite
-- is right here: a Math.random nonce is exactly the credential this phase exists to retire, and
-- carrying one forward as a SHA-256 hash would launder a weak token into a strong-looking column.
-- Any outstanding QR is invalidated by design; the pickup is re-issued through the new service.

-- 1. UNIQUENESS. This is what makes single use enforceable at all: without it two pickups can
--    carry the same hash and `findUnique` cannot resolve a token to one appointment.
CREATE UNIQUE INDEX IF NOT EXISTS "pickups_token_hash_key"
  ON "pickups" ("token_hash");

-- 2. THE LIVE-TOKEN LOOKUP. Partial, because the scan only ever asks about live tokens and the
--    predicate is the DEFINITION of live: minted, not spent, not revoked. An index whose WHERE
--    clause drifts from the resolver's WHERE clause silently scans the wrong set, so the two are
--    written to match exactly — `release-token.service.ts` resolves on these same three columns.
CREATE INDEX IF NOT EXISTS "pickups_live_release_token_idx"
  ON "pickups" ("token_expires_at")
  WHERE "token_hash" IS NOT NULL
    AND "token_consumed_at" IS NULL
    AND "token_revoked_at" IS NULL;

-- 3. CLEAR THE LEGACY PLAINTEXT. Both columns, in this migration, for the reason above.
--    Not dropped: dropping a column is a schema removal and is the owner's separate decision
--    (see FOLLOW-UP). Nulling them ends the credential exposure now; the code stops writing them
--    in the same change, so they cannot repopulate.
UPDATE "pickups"
   SET "qr_code_data"  = NULL,
       "qr_code_image" = NULL
 WHERE "qr_code_data" IS NOT NULL
    OR "qr_code_image" IS NOT NULL;

-- ── VERIFICATION (run after applying; all four must hold) ────────────────────
--   -- no plaintext credential survives anywhere:
--   SELECT count(*) FROM pickups WHERE qr_code_data IS NOT NULL OR qr_code_image IS NOT NULL;
--     -> expected 0
--   -- the unique index exists and is VALID (an INVALID index enforces nothing while looking present):
--   SELECT count(*) FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE c.relname = 'pickups_token_hash_key' AND i.indisvalid;
--     -> expected 1
--   -- the partial index exists with the predicate the resolver uses:
--   SELECT count(*) FROM pg_indexes WHERE indexname = 'pickups_live_release_token_idx'
--     AND indexdef LIKE '%token_consumed_at IS NULL%' AND indexdef LIKE '%token_revoked_at IS NULL%';
--     -> expected 1
--   -- no two pickups share a hash:
--   SELECT count(*) FROM (SELECT token_hash FROM pickups WHERE token_hash IS NOT NULL
--                         GROUP BY 1 HAVING count(*) > 1) d;
--     -> expected 0

-- ── FOLLOW-UP, NOT INCLUDED HERE ────────────────────────────────────────────
--   Dropping these columns outright is a schema removal and needs its own owner decision. Once
--   this is verified in production:
--     ALTER TABLE "pickups" DROP COLUMN "qr_code_image";
--     ALTER TABLE "pickups" DROP COLUMN "qr_code_data";
--     ALTER TABLE "pickups" DROP COLUMN "qr_expires_at";
--
--   `qr_expires_at` joins them because this change removes its last WRITER as well: the dealer
--   scan reads `token_expires_at` now, and the buyer's screen reads the expiry off the mint
--   response. It is NOT cleared above — it is a timestamp, not a credential, and clearing a
--   third column the owner did not rule on is scope this change does not have. It is left
--   readable and unwritten, which is a stale field rather than a live exposure. Two expiries
--   that can disagree is the reason it should go, not urgency.
--
--   As of 2026-09-16, verified by grep across app/, lib/ and components/: no application logic
--   reads or writes any of the three. `qr_code_data` and `qr_code_image` appear ONLY in
--   pickup-select.ts, which classifies them as withheld from every response, and in the tests
--   that pin their absence. `qr_expires_at` additionally survives as a PUBLISHED-but-unwritten
--   entry in PICKUP_SAFE_SELECT: it is not a secret, so withholding it would be the wrong
--   classification, and it reads NULL on every row until the drop lands.
