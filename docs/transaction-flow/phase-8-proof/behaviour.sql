-- Phase 8 BEHAVIOUR proof — the ruling, not the DDL.
--
-- A schema assertion can tell you an index exists. It cannot tell you the index enforces the
-- RIGHT THING, and §13-D30 is entirely about which duplicates are legal:
--
--   BEFORE: at most one envelope per deal_id.  The co-buyer cannot sign.
--   AFTER:  at most one envelope per (deal_id, signer_kind). The co-buyer can sign, and a
--           SECOND BUYER envelope is still refused.
--
-- The second half is the one worth proving. It would be easy to drop the absolute unique and
-- accidentally leave the table with no protection at all — the schema would look right, the
-- verify would pass, and a retry or a double-submit would quietly write two BUYER envelopes
-- for one deal, each with its own consent snapshot, each claiming to be the signature.
--
-- Run against real rows inside a transaction that is ROLLED BACK, so the proof leaves nothing
-- behind. Every assertion prints OK or FAIL; run-proof.sh greps for FAIL.

\set ON_ERROR_STOP off
\pset footer off

BEGIN;

-- Every assertion records here, so the terminal row reports how many ACTUALLY RAN rather
-- than asserting its own success. An aborted transaction leaves this empty, and the harness
-- refuses a run that does not report six.
CREATE TEMP TABLE proof_assertions (verdict text, detail text) ON COMMIT DROP;

-- Minimal graph: the FKs on e_sign_envelopes.deal_id require a real deal, which requires a
-- buyer, which requires a user. Built here rather than assumed so the proof runs on an empty
-- chain-built database.
-- `supabase_id` is NOT NULL with no default, and the first version of this file omitted it.
-- The INSERT failed, the transaction aborted, EVERY assertion below was skipped with
-- "current transaction is aborted" — and the terminal row still printed "6 assertions, all
-- rolled back" while the harness reported "every behaviour assertion held". A proof that
-- announces success having proven nothing is the worst outcome available here, and it is
-- the same silent-zero-row failure preflight.sql exists to warn about, one level up. The
-- terminal row now COUNTS the assertions that actually ran, and the harness requires six.
INSERT INTO users (id, supabase_id, email, role, created_at, updated_at)
VALUES ('u_proof8', 'sb_proof8', 'proof8@example.invalid', 'BUYER', now(), now());

INSERT INTO buyers (id, user_id, first_name, last_name, created_at, updated_at)
VALUES ('b_proof8', 'u_proof8', 'Proof', 'Eight', now(), now());

-- `deals_offer_lineage_check` requires offer_id OR vehicle_request_offer_id: §3's "one
-- lineage, never broken" enforced in the database. The concierge lineage is the cheaper of
-- the two to build here (a request and an offer row, against an auction + dealer + rooftop
-- graph for the auction lineage), and the uniqueness behaviour under test does not depend on
-- which lineage the deal carries.
INSERT INTO vehicle_requests (id, buyer_id, created_at, updated_at)
VALUES ('vr_proof8', 'b_proof8', now(), now());

INSERT INTO vehicle_request_offers (id, request_id, vehicle_info, price_cents, created_at, updated_at)
VALUES ('vro_proof8', 'vr_proof8', '{"note":"phase-8 behaviour proof"}'::jsonb, 3245000, now(), now());

INSERT INTO deals (id, buyer_id, vehicle_request_offer_id, status, created_at, updated_at)
VALUES ('d_proof8', 'b_proof8', 'vro_proof8', 'SIGNING_PENDING', now(), now());

-- 1. THE BUYER'S ENVELOPE. The ordinary case, which must still work.
INSERT INTO e_sign_envelopes (id, deal_id, signer_kind, status, created_at, updated_at)
VALUES ('env_buyer8', 'd_proof8', 'BUYER', 'SENT', now(), now());
INSERT INTO proof_assertions (verdict, detail)
SELECT CASE WHEN count(*) = 1 THEN 'OK   ' ELSE 'FAIL ' END, 'a BUYER envelope is accepted'
  FROM e_sign_envelopes WHERE deal_id = 'd_proof8' AND signer_kind = 'BUYER'
RETURNING verdict || ' ' || detail AS assertion;

-- 2. THE CO-BUYER'S ENVELOPE ON THE SAME DEAL. Refused before this migration by
--    e_sign_envelopes_deal_id_key; the entire point of the cutover is that it now succeeds.
SAVEPOINT co_buyer;
INSERT INTO e_sign_envelopes (id, deal_id, signer_kind, status, created_at, updated_at)
VALUES ('env_cobuyer8', 'd_proof8', 'CO_BUYER', 'SENT', now(), now());
INSERT INTO proof_assertions (verdict, detail)
SELECT CASE WHEN count(*) = 1 THEN 'OK   ' ELSE 'FAIL ' END, 'a CO_BUYER envelope on the SAME deal is now ACCEPTED (§13-D30, the whole point)'
  FROM e_sign_envelopes WHERE deal_id = 'd_proof8' AND signer_kind = 'CO_BUYER'
RETURNING verdict || ' ' || detail AS assertion;

-- 3. A SECOND BUYER ENVELOPE MUST STILL BE REFUSED. This is the assertion that proves the
--    drop did not leave the table unprotected. Expect 23505.
SAVEPOINT second_buyer;
INSERT INTO e_sign_envelopes (id, deal_id, signer_kind, status, created_at, updated_at)
VALUES ('env_buyer8_dupe', 'd_proof8', 'BUYER', 'SENT', now(), now());
ROLLBACK TO SAVEPOINT second_buyer;
INSERT INTO proof_assertions (verdict, detail)
SELECT CASE WHEN count(*) = 1 THEN 'OK   ' ELSE 'FAIL ' END, 'a SECOND BUYER envelope is still REFUSED — the composite unique is doing real work'
  FROM e_sign_envelopes WHERE deal_id = 'd_proof8' AND signer_kind = 'BUYER'
RETURNING verdict || ' ' || detail AS assertion;

-- 4. AND A SECOND CO_BUYER ENVELOPE IS REFUSED TOO. The new rule is one per SIGNER, not
--    "two per deal" — a deal must not accumulate envelopes.
SAVEPOINT second_cobuyer;
INSERT INTO e_sign_envelopes (id, deal_id, signer_kind, status, created_at, updated_at)
VALUES ('env_cobuyer8_dupe', 'd_proof8', 'CO_BUYER', 'SENT', now(), now());
ROLLBACK TO SAVEPOINT second_cobuyer;
INSERT INTO proof_assertions (verdict, detail)
SELECT CASE WHEN count(*) = 2 THEN 'OK   ' ELSE 'FAIL ' END, 'exactly TWO envelopes on the deal — one per signer, never more'
  FROM e_sign_envelopes WHERE deal_id = 'd_proof8'
RETURNING verdict || ' ' || detail AS assertion;

-- 5. signer_kind DEFAULTS TO 'BUYER'. This is what makes the composite index exactly as
--    strict as the absolute one for every row written before Phase 8 — the property the
--    whole cutover ordering rests on, asserted rather than assumed.
INSERT INTO vehicle_request_offers (id, request_id, vehicle_info, price_cents, created_at, updated_at)
VALUES ('vro_proof8b', 'vr_proof8', '{"note":"phase-8 default proof"}'::jsonb, 3245000, now(), now());
INSERT INTO deals (id, buyer_id, vehicle_request_offer_id, status, created_at, updated_at)
VALUES ('d_proof8b', 'b_proof8', 'vro_proof8b', 'SIGNING_PENDING', now(), now());
INSERT INTO e_sign_envelopes (id, deal_id, status, created_at, updated_at)
VALUES ('env_default8', 'd_proof8b', 'SENT', now(), now());
INSERT INTO proof_assertions (verdict, detail)
SELECT CASE WHEN signer_kind::text = 'BUYER' THEN 'OK   ' ELSE 'FAIL ' END,
       'an INSERT omitting signer_kind takes ''BUYER'' from the column default'
  FROM e_sign_envelopes WHERE id = 'env_default8'
RETURNING verdict || ' ' || detail AS assertion;

-- 6. THE CLEARANCE COLUMNS ACCEPT NULL. A NOT NULL would make a financing row unwritable
--    before Finance has all three facts, which is the whole workflow this phase builds.
INSERT INTO financing (id, deal_id, path, status, selected_at)
VALUES ('fin_proof8', 'd_proof8', 'EXTERNAL', 'TERMS_LOCKED', now());
INSERT INTO proof_assertions (verdict, detail)
SELECT CASE WHEN lender_conditions_cleared_at IS NULL
             AND down_payment_method IS NULL
             AND dealer_funding_confirmed_at IS NULL
            THEN 'OK   ' ELSE 'FAIL ' END,
       'a financing row is writable with every clearance column still unknown'
  FROM financing WHERE id = 'fin_proof8'
RETURNING verdict || ' ' || detail AS assertion;

-- THE TERMINAL ROW COUNTS WHAT RAN. It cannot report success for assertions that never
-- executed, which is exactly what the first version of this file did.
SELECT CASE WHEN count(*) = 6 AND count(*) FILTER (WHERE verdict LIKE 'FAIL%') = 0
            THEN 'OK    behaviour proof complete — 6 of 6 assertions ran and held'
            ELSE 'FAIL  behaviour proof ran only ' || count(*)::text || ' of 6 assertions ('
                 || count(*) FILTER (WHERE verdict LIKE 'FAIL%')::text || ' failed)'
       END AS assertion
  FROM proof_assertions;

-- Nothing is kept. The proof asserts behaviour; it does not seed data.
ROLLBACK;
