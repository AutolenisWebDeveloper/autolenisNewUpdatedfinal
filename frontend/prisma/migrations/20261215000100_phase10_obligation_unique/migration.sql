-- Phase 10 — §13-D60: the constraint `openObligation` has always claimed and never had.
--
-- STATUS: AUTHORED, NOT APPLIED. Applying it is the owner's, per run.
--
-- THE RULING. §13-D60 (registered 2026-09-17, from the second independent Phase 9 review) records
-- that `openObligation` documents itself as IDEMPOTENT PER (deal, type) and implements that as a
-- `findFirst` then `create`, with no unique constraint behind it — `PostCompletionObligation`
-- carried only `@@index([dealId])`. Two concurrent callers would produce two PENDING rows for one
-- (deal, type) and double-count on the dealership scorecard, which is the harm the function's own
-- comment names.
--
-- The owner ruled on 2026-09-17 that Phase 9 would NOT add it: "An index added now guards nothing
-- and a §13 row naming the precondition guards the future" — the only caller ran inside the
-- completion CAS's winning transaction, so no second caller could interleave. The row closes with
-- a standing condition: it "stays open until the index lands OR a second writer is proposed,
-- whichever comes first — and a second writer proposed before the index is a BLOCK".
--
-- WHY IT LANDS NOW. Phase 10 builds §Stage 21's resolution control, which §13-D60 names as "the
-- nearest candidate" for that second writer. The route Phase 10 adds RESOLVES an obligation and
-- never opens one, so it does not itself trip the block — but shipping the resolution surface
-- without the constraint would leave the precondition standing while the surface it was written
-- about exists. The index is additive, costs nothing, and retires the row.
--
-- THE SHAPE IS THE RULING'S, VERBATIM: "a partial unique index on (deal_id, type)
-- WHERE status <> 'RESOLVED'". PARTIAL, so a RESOLVED obligation does not bar a legitimately
-- recurring one — the same carve-out reasoning §13-D59 applies to terminal deal statuses. A full
-- unique would make a second temp-tag obligation on the same deal impossible forever, which is
-- not what idempotency means here.
--
-- NO BACKFILL AND NO CLEANUP, AND THAT IS CHECKED RATHER THAN ASSUMED. `deals` holds ZERO rows in
-- production (owner census, 2026-09-17), so `post_completion_obligations` holds zero by foreign
-- key. There is nothing to deduplicate. CREATE UNIQUE INDEX would fail loudly on a duplicate
-- rather than silently dropping one, which is the correct behaviour if that assumption is ever
-- wrong: a failed migration is recoverable, a silently discarded obligation is not.
--
-- NOT `CONCURRENTLY`: that cannot run inside Prisma's per-file transaction, and on an empty table
-- there is nothing to build concurrently with.
--
-- IDEMPOTENT: IF NOT EXISTS makes re-apply a no-op.
-- ROLLBACK: DROP INDEX IF EXISTS "post_completion_obligations_open_deal_type_key";

CREATE UNIQUE INDEX IF NOT EXISTS "post_completion_obligations_open_deal_type_key"
  ON "post_completion_obligations" ("deal_id", "type")
  WHERE "status" <> 'RESOLVED';

COMMENT ON INDEX "post_completion_obligations_open_deal_type_key" IS
  '§13-D60. openObligation is idempotent per (deal, type); this is the constraint that makes that true under concurrency rather than by single-writer convention. Partial on status <> RESOLVED so a recurring obligation is still possible once the prior one is closed.';
