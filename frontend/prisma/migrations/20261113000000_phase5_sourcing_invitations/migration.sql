-- Phase 5 — dealer sourcing, invitations, launch readiness, identity firewall.
--
-- WRITTEN BUT NOT APPLIED. Ships for owner review; applies after 20261112000000.
--
-- FIVE ADDITIVE CHANGES, and deliberately no more. Phase 1's transaction-spine wave
-- already provisioned almost everything this phase needs -- `sourcing_cases`,
-- `sourcing_candidates`, nineteen new `auction_invitations` columns including
-- `token_hash`, `candidate_ids`, `distance_miles` and the 50/90 reminder stamps,
-- `dealer_rooftops.operating_status`, and the `RADIUS_AUTHORIZATION_REQUIRED` status --
-- and left all of it with zero readers and zero writers. Phase 5 is overwhelmingly a
-- WIRING phase. What follows is only what the wave could not have known it needed.
--
-- Every object created here is declared in schema.prisma, so this file adds no
-- structural drift: `prisma/drift-baseline.json` stays at 344. That is the same
-- property Phase 1 established for its own wave and the reason the ratchet still means
-- something. In particular the two new uniques are PLAIN composite uniques rather than
-- the `WHERE ... IS NOT NULL` partials Phase 1 used, because PostgreSQL already treats
-- NULLs as distinct -- so a plain unique has identical semantics for the rows we care
-- about and, unlike a partial, Prisma can model it. See each one below.
--
-- ORDERING AGAINST THE APPLICATION DEPLOY: **MIGRATION FIRST, WITHOUT EXCEPTION.**
-- Additive, and NOT safe in either order. Stated plainly because
-- 20261111000000_deposit_status_disputed claimed "safe in either order" and was wrong,
-- and 20261112000000 corrected the habit rather than the single file.
--
-- Two independent mechanisms make an application-first deploy fail:
--
--   1. Prisma selects EVERY scalar a model declares unless the query narrows it. Once
--      these columns are on `CircumventionAttempt`, `IdentityFirewallEntry` and
--      `ApolloReveal` and the client is regenerated, an unnarrowed read asks PostgreSQL
--      for columns an unmigrated database does not have and fails with
--      **42703 undefined_column** (Prisma surfaces it as P2022).
--   2. This phase's new code WRITES these columns on the hot paths. Symmetric
--      circumvention scanning writes `initiator_role` and `after_paid_auction` on every
--      flagged buyer<->dealer message; launch readiness writes the withheld-state
--      `identity_firewall_entries` row per auction and rooftop before an auction may go
--      ACTIVE; paid enrichment writes `sourcing_case_id` on every reveal. Unmigrated,
--      the first of those rejects dealer messages, the second HOLDS every auction at
--      PENDING -- a launch that cannot reach readiness, which is the one failure mode
--      §7 says must surface a blocker rather than half-launch -- and the third refuses
--      the spend that §6b gates on a settled deposit.
--
-- THE REVERSE ORDER IS SAFE, and that is why the order is stated rather than merely
-- preferred. Every column added here is nullable or defaulted; the relaxation in change 2
-- only widens what is accepted; and the two new uniques constrain states no deployed code
-- can currently produce (nothing writes `identity_firewall_entries` at all, and
-- `sourcing_candidates` has never held a row). A database carrying these objects ahead of
-- the code that reads them costs nothing. Apply, then deploy.
--
-- RLS: untouched throughout. Every table below has relrowsecurity=true with zero
-- policies and the application connects as the table owner. Adding columns, indexes and
-- uniques changes none of that, and adding a policy to a zero-policy table would OPEN
-- access rather than harden it.
--
-- NO CHECK CONSTRAINTS. This chain holds exactly three, all from the Phase 1 wave;
-- Prisma cannot model them, and `scripts/check-migration-drift.ts` fails in both
-- directions once `prisma migrate diff` sees a structural statement off the recorded
-- baseline. The two new string vocabularies below (`initiator_role`, `state`) live in
-- code for the same reason `sourcing_cases.status` does -- see
-- `lib/services/sourcing/sourcing-case.service.ts`, which states that rule.
--
-- IDEMPOTENT: every statement is `IF NOT EXISTS` or naturally repeatable, so a re-apply
-- is a no-op emitting only NOTICEs. Proved by round trip -- see the phase-5-proof
-- directory.
--
-- ROLLBACK: see rollback.sql in this directory. Roll the CODE back first.


-- ===========================================================================
-- 1. circumvention_attempts -- attribution and scope for §25.2
-- ===========================================================================
--
-- §25.2's consequence rule is scoped twice, and the table could express neither.
--
--   "A confirmed attempt to move the transaction off-platform AFTER A PAID AUCTION is a
--    dealer agreement violation" -- so the consequence needs to know whether a paid
--    auction existed at detection time.
--   "Buyers are protected, not penalized, WHEN THE DEALERSHIP INITIATES" -- so the row
--    needs to record which party initiated.
--
-- Phase 1 added `dealer_id`, which names the dealership a thread belongs to. It does NOT
-- say the dealership was the initiator: `user_id` is the sender, but `Message.sender_id`
-- is a bare string with no relation and `message_threads` carries neither `buyer_id` nor
-- `dealer_id`, so the sender's ROLE is not derivable from the stored row. It is resolved
-- at detection through `message_thread_participants` and recorded here, once, rather
-- than re-derived by every later reader from data that cannot answer.
--
-- `pattern` is NOT added: it already exists and is NOT NULL. The §25.2 defect was never
-- a missing column -- `recordCircumventionAttempt` has simply never been called, and the
-- one path that does scan overwrites the message with a fixed literal and stores a
-- category ("Phone number detected") in `Message.redact_reason` instead of the matched
-- pattern. This phase starts writing the column that was always there.
--
-- ALL FOUR ARE NULLABLE, and `after_paid_auction` is deliberately not DEFAULT false.
-- NULL means "not determined"; false means "determined, and there was no paid auction".
-- Those carry different consequences under §25.2, and a DEFAULT false would silently
-- record every future row whose resolution failed as a non-violation.

ALTER TABLE "circumvention_attempts"
  ADD COLUMN IF NOT EXISTS "initiator_role"     TEXT,
  ADD COLUMN IF NOT EXISTS "after_paid_auction" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "resolution"         TEXT,
  ADD COLUMN IF NOT EXISTS "resolved_at"        TIMESTAMP(3);

-- Operations resolves detections by dealership and by recency (§26 "Circumvention
-- detected -> Operations -> review; scorecard, suspension, or termination"), and D42's
-- 90-day repeat window is a range scan over exactly this pair.
CREATE INDEX IF NOT EXISTS "circumvention_attempts_dealer_id_detected_at_idx"
  ON "circumvention_attempts" ("dealer_id", "detected_at");


-- ===========================================================================
-- 2. identity_firewall_entries -- the firewall STATE, not just the alert
-- ===========================================================================
--
-- §11.6 rules the identity firewall in half: Phase 5 builds it, Phase 7 performs the
-- lift at reaffirmation. HTML S[6] lists `identity_firewall_entries` among Stage 7's
-- tables, and §10.6 row 25-10 requires a withheld-state entry per auction and rooftop
-- written at launch.
--
-- The table as built cannot express that. It is an ALERT record -- (buyer_id, dealer_id,
-- flag, description, risk_score) -- with `flag` a NOT NULL `AntiCircumventionFlag`, and
-- it has zero reads and zero writes anywhere in the application. A withheld-state entry
-- has no circumvention flag, and it is scoped to an auction and a rooftop, neither of
-- which the table names.
--
-- EXTENDED RATHER THAN REPLACED, because golden rule 1 says extend the existing
-- architecture and because the specification names this table by name. A second
-- `auction_identity_firewall` table would be the parallel system that rule exists to
-- forbid.
--
-- `flag` LOSES ITS NOT NULL, and this is the one relaxation in the file. It is
-- backward-compatible in every direction that matters: no existing row changes, every
-- existing reader still sees what it saw (there are none), and anything that writes an
-- alert still supplies a flag. Production holds ZERO rows (owner census, 2026-09-11), so
-- nothing is reinterpreted. The alternative -- adding a WITHHELD label to
-- `AntiCircumventionFlag` -- was rejected: it would make a firewall state
-- indistinguishable from a circumvention pattern in every query that groups by flag, and
-- §8.2's own history records enum labels coming to exist with no ledger row as a thing
-- this programme is correcting.
--
-- `state` is TEXT with its vocabulary in code (WITHHELD | LIFTED), matching
-- `sourcing_cases.status`. Phase 5 writes only WITHHELD; Phase 7 writes LIFTED with
-- `lifted_at` and `lifted_by`. The columns ship now so the lift has somewhere to land
-- and so a reader can tell a withheld auction from an unrecorded one -- but NOTHING in
-- this phase writes LIFTED, which is the §11.6 split made mechanical.

ALTER TABLE "identity_firewall_entries"
  ADD COLUMN IF NOT EXISTS "auction_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rooftop_id" TEXT,
  ADD COLUMN IF NOT EXISTS "state"      TEXT,
  ADD COLUMN IF NOT EXISTS "lifted_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lifted_by"  TEXT;

ALTER TABLE "identity_firewall_entries"
  ALTER COLUMN "flag" DROP NOT NULL;

-- One firewall entry per auction per rooftop. A PLAIN composite unique, not the
-- `WHERE "auction_id" IS NOT NULL` partial Phase 1 would have written: PostgreSQL treats
-- NULLs as distinct, so legacy alert rows -- which carry NULL in both columns -- are
-- entirely unconstrained by it, exactly as the partial would have left them, while two
-- withheld entries for one auction and rooftop collide. Identical semantics, and Prisma
-- can declare it, so it costs no drift.
CREATE UNIQUE INDEX IF NOT EXISTS "identity_firewall_entries_auction_id_rooftop_id_key"
  ON "identity_firewall_entries" ("auction_id", "rooftop_id");


-- ===========================================================================
-- 3. apollo_reveals.sourcing_case_id -- the paid-spend link §6b requires
-- ===========================================================================
--
-- Two requirements converge on one column.
--
--   §6b / master §5: "paid enrichment runs only after payment and only when stored and
--   public paths fail". Today nothing links a reveal to a paid anything: `BackfillParams`
--   and `RevealInput` carry no request, deposit or auction, and the only provenance is
--   `consumer` in {live, backfill}. The designed gate is dead code -- `allowPaid` is set
--   true only in tests.
--   §6c "Recorded": the sourcing case records "enrichment spend".
--
-- One column answers both: a reveal carries the case that authorised it, and the case's
-- spend is `SUM(credits_cost) WHERE sourcing_case_id = <case>`. Preferred over a
-- denormalised counter on `sourcing_cases` because §3 requires lineage never to break --
-- a counter says how much was spent, a link says which rooftop each credit bought.
--
-- A SOFT KEY WITH NO FOREIGN KEY, matching this table's own existing convention:
-- `apollo_reveals.rooftop_id` is NOT NULL with no FK and no Prisma relation, so a
-- deleted rooftop already leaves reveal rows standing. Adding an FK here and not there
-- would be the inconsistency, and a CASCADE from `sourcing_cases` would delete the
-- financial record of credits actually spent when a case closes -- which §6c requires to
-- survive.

ALTER TABLE "apollo_reveals"
  ADD COLUMN IF NOT EXISTS "sourcing_case_id" TEXT;

CREATE INDEX IF NOT EXISTS "apollo_reveals_sourcing_case_id_idx"
  ON "apollo_reveals" ("sourcing_case_id");


-- ===========================================================================
-- 4. sourcing_candidates -- the dedup backstop the table shipped without
-- ===========================================================================
--
-- §6a step 0 ends "Sets are unioned across candidates and deduped by rooftop", and §33
-- step 29 is "dedupe to one invitation per rooftop". `auction_invitations` got a database
-- backstop for that invariant in the Phase 1 wave
-- (`auction_invitations_auction_rooftop_key`). `sourcing_candidates` -- the table where
-- the dedup actually happens, one rung earlier -- got NO uniqueness at all: its only
-- index is on `sourcing_case_id`, so the same rooftop can be inserted twice into one
-- case and `sourcing_cases.coverage_count` has nothing holding it honest. The asymmetry
-- is not deliberate; the table had no readers, so nothing had tested it.
--
-- It matters under concurrency specifically. Band expansion is a read-then-insert over a
-- rooftop set, and the reconciler tick that drives it can overlap a buyer-triggered
-- expansion on the same case. Without the unique, the overlap double-counts coverage and
-- the §6c decision table then reads a field of 8 that is really 4 -- which launches an
-- auction the spec says requires audited approval.
--
-- PLAIN composite unique, same reasoning as change 2: `rooftop_id` is nullable, NULLs are
-- distinct, so rows with no resolved rooftop stay unconstrained while two rows for one
-- (case, rooftop) collide.
CREATE UNIQUE INDEX IF NOT EXISTS "sourcing_candidates_sourcing_case_id_rooftop_id_key"
  ON "sourcing_candidates" ("sourcing_case_id", "rooftop_id");

-- The `rooftop_id` foreign key shipped unindexed, so the SET NULL that fires when a
-- rooftop is deleted has to sequentially scan, and so does every "which cases has this
-- rooftop served" read -- which is the §6c ranking input and the D42 suspension check.
CREATE INDEX IF NOT EXISTS "sourcing_candidates_rooftop_id_idx"
  ON "sourcing_candidates" ("rooftop_id");

-- NOTE, REPORTED NOT ACTED ON: `sourcing_candidates_case_idx` on ("sourcing_case_id")
-- is now a redundant leftmost-prefix of the composite unique above. Dropping it is a
-- DROP against a production database and an owner decision, so it stays; it is declared
-- in schema.prisma and costs only a little write amplification on a table with no rows.


-- ===========================================================================
-- 5. auction_invitations.candidate_ids -- close the SQL/Prisma nullability gap
-- ===========================================================================
--
-- The column is `TEXT[]` with NO DEFAULT and nullable in SQL, while Prisma declares
-- `candidateIds String[]` -- non-nullable, no `@default`. Its sibling one table over,
-- `sourcing_candidates.served_candidate_ids`, is `TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`
-- with `@default([])`. The asymmetry is invisible today because nothing reads either.
--
-- It stops being invisible in this phase: S7-23 fills `candidate_ids` per invitation and
-- every dealer-facing payload iterates it. A row holding SQL NULL against a client type
-- that promises `String[]` is a P2022 on read and an undefined-iteration TypeError on
-- use -- aimed precisely at the new code.
--
-- THE THREE STATEMENTS ARE ORDERED AND THE ORDER IS LOAD-BEARING. DEFAULT first, so any
-- insert racing the migration already gets an empty array rather than NULL; then the
-- backfill, which is the "verified backfill" a NOT NULL on an existing table requires;
-- then NOT NULL, which can only succeed if the backfill did. Production holds 6
-- `auction_invitations` rows (owner census, 2026-09-11), so the UPDATE is trivially
-- small and there is no long-lock concern -- but the order would still be correct at any
-- size, and `ALTER TABLE ... SET NOT NULL` verifying the column itself is what makes the
-- backfill proven rather than asserted.

ALTER TABLE "auction_invitations"
  ALTER COLUMN "candidate_ids" SET DEFAULT ARRAY[]::TEXT[];

UPDATE "auction_invitations"
   SET "candidate_ids" = ARRAY[]::TEXT[]
 WHERE "candidate_ids" IS NULL;

ALTER TABLE "auction_invitations"
  ALTER COLUMN "candidate_ids" SET NOT NULL;
