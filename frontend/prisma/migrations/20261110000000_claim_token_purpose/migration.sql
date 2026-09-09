-- Scope the buyer request claim tokens: what each one is FOR.
--
-- WRITTEN BUT NOT APPLIED. Ships for owner review; applies after 20261106000100.
--
-- WHY. `buyer_request_claim_tokens` carries a hash, a buyer, an optional request, an
-- expiry and a consumed-at. Nothing says what a token authorises, and the rule-16
-- tier-2 lookup matches on the hash alone:
--
--     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
--
-- Two call sites mint into this table and they mint the same shape. One is the
-- rule-16 claim link, which is meant to authorise a write on the request it names.
-- The other is the $99 pre-checkout resume link, whose own comment says the token
-- "carries NO PII and no capability -- it deep-links to the auth-gated $99
-- checkout". That second statement stopped being true when tier 2 was added: a
-- deposit-reminder token pasted into `/request-vehicle?claim=` or posted to
-- `/api/public/request-vehicle/complete` is a tier-2 write credential for that
-- buyer's account. The resume route's security comment is stale, and no column
-- exists to make it true again.
--
-- SCOPE: ADDITIVE ONLY. One nullable TEXT column and one backfill of that column's
-- own NULLs. No DROP, no rename, no index, no constraint, and nothing outside this
-- table is read or written.
--
-- WHY `legacy_unscoped` AND NOT A REAL BACKFILL. Existing rows cannot be attributed.
-- Both minting sites call `issueResumeToken({ buyerId })` with no distinguishing
-- field, so the data does not record which produced any given row. Backfilling
-- everything to `resume` would break in-flight claim links; to `claim` would leave
-- deposit links as write credentials. A third value that both paths accept is the
-- only honest reading, and it is self-limiting: the TTL is five days, so every
-- legacy row expires within five days of this applying, after which the
-- compatibility branch is dead and can be removed. At the time of writing there are
-- 2 live rows, both from the 2026-09-08 capture.
--
-- NO NOT NULL AND NO DEFAULT, DELIBERATELY. A NOT NULL column would have to be added
-- and backfilled in one statement against a table the application is writing to, and
-- a DEFAULT would silently give a purpose to any future insert that forgot to state
-- one -- which is the same class of mistake as having no column at all. The
-- application supplies the value explicitly and the type system requires it.
--
-- ORDERING. `schema.prisma` declares this column, and Prisma's default read selects
-- every declared scalar, so a deployment that reaches production before this applies
-- raises 42703 undefined_column on every read of the table. Every access point has
-- been given an explicit select to shrink that surface, but the code that FILTERS on
-- `purpose` cannot work before the column exists. Apply this, verify both halves,
-- then deploy -- IMPLEMENTATION-WORKFLOW section 8.1a.2 is binding for the order.
--
-- IDEMPOTENT. Guarded so the CI migrations job, which replays the whole chain twice
-- against an empty database, produces the same result on both passes.

ALTER TABLE "buyer_request_claim_tokens"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT;

-- Scoped to its own NULLs: a re-run touches nothing, and a row written by the
-- application between the ALTER and this UPDATE already carries a real purpose and is
-- left alone.
UPDATE "buyer_request_claim_tokens"
   SET "purpose" = 'legacy_unscoped'
 WHERE "purpose" IS NULL;
