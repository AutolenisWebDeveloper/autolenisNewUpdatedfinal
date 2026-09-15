-- Phase 8 — §13-D30's invited-signer link. OWNER-AUTHORISED 2026-09-15, with conditions.
--
-- WHY THIS EXISTS. A required co-buyer has no platform account, by the owner's own §13-D30
-- ruling, and the signing link landed on a Supabase-authenticated page. So the envelope was
-- reachable by nobody: every deal with `co_buyers.is_required_signer` set deadlocked at
-- SIGNING_PENDING until the envelope expired at 14 days. The surface was withheld from the
-- first Phase 8 wave because a route letting an account-less party legally execute a contract
-- is a SERVER-AUTHORIZATION change, and the design ruling was not the authorization for it.
-- The authorization was given separately, and it carries six conditions.
--
-- THE MECHANISM IS NOT NEW. Phase 2's dealer_account_claim_tokens and Phase 5's
-- auction_invitations both mint a hashed, expiring, subject-bound token reachable without an
-- account. This is the same shape at higher stakes, which is why it reuses
-- account-claim.service.ts's hashToken/generateRawToken rather than inventing a second
-- token scheme.
--
-- CORE RULE 11, THE FORWARD FORM. All three columns are ADDITIVE and NULLABLE, so no existing
-- reader relied on a guarantee that changes and no existing row becomes invalid. The MIRROR
-- rule is the one that applies (§8.1h): a column gaining its first writer breaks readers that
-- relied on its emptiness. All three are introduced by this wave and have no reader before it,
-- so that list is empty by construction — stated rather than assumed.

-- The credential. Only the SHA-256 is ever stored; the raw token exists in the emailed link
-- and nowhere else. UNIQUE so a replayed mint or a hash collision cannot address two
-- envelopes. NULL on every BUYER envelope, and Postgres does not treat NULLs as equal, so the
-- unique index permits as many null rows as there are buyers.
ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "signer_access_token_hash" TEXT;

-- Condition 3: short expiry, with the envelope's own 14-day contract expiry as the CEILING.
-- A signing token must never outlive the version it signs, so this is capped at
-- `expires_at` by the service and is checked independently of it at resolve time.
-- TIMESTAMP(3), NOT TIMESTAMPTZ — matching this table and the Prisma model.
--
-- The first draft of this migration used TIMESTAMPTZ and the drift gate caught it. It was not
-- a tidiness issue: all twelve existing timestamps on e_sign_envelopes are `timestamp without
-- time zone`, and `resolveSignerToken` compares THIS column directly against `expires_at`.
-- One tz-aware and one tz-naive column in the same comparison is a signing window that is
-- wrong by the server's UTC offset — a token live for hours after it should have closed, or
-- dead hours early, depending on which way the offset runs. Match the table.
ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "signer_access_token_expires_at" TIMESTAMP(3);

-- Condition 1: SINGLE USE. Consumed on signature under a compare-and-swap on NULL, so two
-- concurrent clicks cannot both succeed. Phase 5's H2 was a token that was written and never
-- consumed; that is the specific mistake this column exists not to repeat.
ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "signer_access_token_consumed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "e_sign_envelopes_signer_access_token_hash_key"
  ON "e_sign_envelopes" ("signer_access_token_hash");

-- A live token is one that is unconsumed and unexpired. Partial index so the lookup path
-- stays on the small set rather than the whole table as envelopes accumulate.
CREATE INDEX IF NOT EXISTS "e_sign_envelopes_live_signer_token_idx"
  ON "e_sign_envelopes" ("signer_access_token_expires_at")
  WHERE "signer_access_token_hash" IS NOT NULL AND "signer_access_token_consumed_at" IS NULL;
