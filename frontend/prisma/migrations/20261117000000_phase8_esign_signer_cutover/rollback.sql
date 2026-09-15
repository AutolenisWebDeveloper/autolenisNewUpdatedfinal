-- Rollback for migration 114 — RESTORE the absolute unique on e_sign_envelopes.deal_id.
--
-- A guarded "drop what we created" cannot revert this migration, because this migration created
-- nothing: it REMOVED a constraint. The revert therefore has to put it back, and putting a UNIQUE
-- index back is the one rollback that can fail on real data.
--
-- SAFE ONLY WHILE NO DEAL HOLDS TWO ENVELOPES. Check first, and do not force it:
--
--   SELECT deal_id, count(*) AS n
--     FROM e_sign_envelopes
--    GROUP BY deal_id
--   HAVING count(*) > 1;
--
-- Zero rows -> this rollback applies cleanly.
-- Any row   -> STOP AND REPORT. A co-buyer has signed. Restoring the index would require deleting
--              one of two executed signature records to decide which survives — destroying legal
--              evidence of a ceremony that actually happened. That is never a migration's call and
--              never an engineer's; it is an owner decision, and the answer is almost certainly
--              "do not revert, roll forward".
--
-- At the time of writing, production holds 0 e_sign_envelopes rows, so the query above returns
-- nothing and this rollback is unconditionally safe.
--
-- The composite index is deliberately LEFT IN PLACE. It is strictly stricter than the absolute one
-- while every row is 'BUYER', so keeping it costs nothing, and dropping it would mean a re-apply of
-- the forward migration hits its own guard and refuses. `signer_kind` and `co_buyer_id` are left in
-- place for the same reason Phase 1 left its columns: an additive column with a default costs
-- nothing to keep and destroying it would destroy the record of which envelope belonged to whom.
--
-- ORDER. Recreate the absolute index BEFORE anything else, so there is no window in which
-- uniqueness is weaker than it was before this file ran.

DO $$
DECLARE dupes INT;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT deal_id FROM e_sign_envelopes GROUP BY deal_id HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'REFUSED: % deal_id(s) hold more than one envelope. Restoring the absolute unique would '
      'require destroying one executed signature record. Report; do not force.', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "e_sign_envelopes_deal_id_key"
  ON "e_sign_envelopes" ("deal_id");
