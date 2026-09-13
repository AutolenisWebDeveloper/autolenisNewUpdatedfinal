-- Phase 5 PRE-FLIP CENSUS — step 7 of the owner's deploy sequence.
--
-- Run IMMEDIATELY BEFORE flipping SOURCING_CASE_REPLACES_AUCTION_LAUNCH, after the migration
-- is applied and verified (steps 2-4) and after the application deploy is confirmed stable
-- (steps 5-6). The owner's 2026-09-11 00:04 UTC census is the reference reading; this file
-- exists because that reading was hours before the flip and the state can change.
--
-- READ-ONLY. Every statement is a SELECT. Run it in the protocol's mandated shape:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-5-proof/census.sql
--
-- WHAT STOPS A FLIP. Two rows can return BLOCK, and both are conditions under which flipping
-- is unsafe rather than merely surprising:
--
--   F1  A PENDING auction exists. The flip hands auction creation to launch readiness; an
--       auction already sitting PENDING was created by the legacy path and has no sourcing
--       case driving it, so nothing will pick it up after the flip. It is stranded, silently,
--       with a buyer who has paid.
--   F2  The Phase 5 migration is not recorded. Flipping before the migration is applied puts
--       the new code on an unmigrated database: symmetric scanning rejects dealer messages,
--       launch readiness HOLDS every auction at PENDING, and paid enrichment refuses to spend.
--
-- Everything else is CHECKED — a figure to read and compare against 00:04, not a gate. That is
-- deliberate: a census that blocks on a count nobody agreed a threshold for would stop a deploy
-- over a number, and the owner is the one who decides what a number means.
--
-- Every GROUP BY row has an explicit "(none)" companion that fires when its table is empty.
-- A grouped query over an empty table emits NOTHING, and an absent row is indistinguishable
-- from a query that did not run — which CLAUDE.md treats as a stop. So emptiness says so.
--
-- Note on ordering: the ORDER BY sorts F1, F2 above the rest so a BLOCK is the first thing on
-- screen rather than something to scroll for.

SELECT 'F1 PENDING auctions (stranded by the flip — nothing drives them afterwards)' AS assertion,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict,
       count(*)::text || ' auction(s)' AS detail
  FROM auctions WHERE status = 'PENDING'
UNION ALL
SELECT 'F2 Phase 5 migration recorded and finished (steps 3-4 completed)',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       CASE WHEN count(*) = 1 THEN 'applied' ELSE 'NOT APPLIED — do not flip' END
  FROM _prisma_migrations
 WHERE migration_name = '20261113000000_phase5_sourcing_invitations'
   AND finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL
-- The reference reading returned {CLOSED: 7}. One row per status actually present, so a status
-- that appears for the first time since 00:04 shows up rather than hiding in a fixed list.
SELECT 'G1 auctions by status — ' || status::text,
       'CHECKED', count(*)::text || ' auction(s)'
  FROM auctions GROUP BY status
UNION ALL
SELECT 'G1 auctions by status — (none)', 'CHECKED', 'the table is empty'
 WHERE NOT EXISTS (SELECT 1 FROM auctions)
UNION ALL
SELECT 'G2 ACTIVE auctions with zero invitations of EITHER kind',
       'CHECKED', count(*)::text || ' auction(s)'
  FROM auctions a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (SELECT 1 FROM auction_invitations i WHERE i.auction_id = a.id)
   AND NOT EXISTS (SELECT 1 FROM outside_auction_invites o WHERE o.auction_id = a.id)
UNION ALL
SELECT 'G3 sourcing_cases by status — ' || status,
       'CHECKED', count(*)::text || ' case(s)'
  FROM sourcing_cases GROUP BY status
UNION ALL
SELECT 'G3 sourcing_cases by status — (none)', 'CHECKED', 'the table is empty'
 WHERE NOT EXISTS (SELECT 1 FROM sourcing_cases)
UNION ALL
-- What the sweep reaches the moment the flag goes on. At 00:04 this was zero because no case
-- existed at all; after the flip it is the work queue, so its size is the blast radius.
SELECT 'G4 OPEN sourcing cases the sweep picks up at the flip',
       'CHECKED', count(*)::text || ' case(s)'
  FROM sourcing_cases
 WHERE closed_at IS NULL AND status <> 'CLOSED'
UNION ALL
SELECT 'G5 sourcing_candidates', 'CHECKED', count(*)::text || ' row(s)' FROM sourcing_candidates
UNION ALL
SELECT 'G6 identity_firewall_entries (§25.1 — lift is Phase 7)',
       'CHECKED', count(*)::text || ' row(s)' FROM identity_firewall_entries
UNION ALL
SELECT 'G7 auction_invitations / outside_auction_invites',
       'CHECKED',
       (SELECT count(*)::text FROM auction_invitations) || ' invitation(s), ' ||
       (SELECT count(*)::text FROM outside_auction_invites) || ' outside invite(s)'
UNION ALL
SELECT 'G8 offers', 'CHECKED', count(*)::text || ' row(s)' FROM offers
UNION ALL
SELECT 'G9 deposits by status — ' || status::text,
       'CHECKED', count(*)::text || ' deposit(s)'
  FROM deposits GROUP BY status
UNION ALL
SELECT 'G9 deposits by status — (none)', 'CHECKED', 'the table is empty'
 WHERE NOT EXISTS (SELECT 1 FROM deposits)
UNION ALL
-- §8.4's removal clock starts AT THE FLIP, not at Phase 3 acceptance (§13-D52). This row is the
-- baseline that clock is measured from, so it is worth capturing at the moment of the flip
-- rather than reconstructed afterwards.
-- `action` is the AdminActionType enum and its only relevant label is LEGACY_PATH_WRITE; the
-- KIND is in metadata->>'kind' (`legacy-path-write.ts:119-124`). Writing
-- `action IN ('LEGACY_PATH_WRITE','SETTLEMENT_AUCTION_LAUNCH')` fails with
-- `invalid input value for enum "AdminActionType"` and takes the whole census down with it —
-- which is how this was found, by running the file rather than reading it.
SELECT 'G10 LEGACY_PATH_WRITE rows to date, all kinds (§8.4 clock baseline)',
       'CHECKED', count(*)::text || ' row(s)'
  FROM audit_logs WHERE action = 'LEGACY_PATH_WRITE'
UNION ALL
SELECT 'G11 …of which SETTLEMENT_AUCTION_LAUNCH — the §13-D52 path the flip closes',
       'CHECKED', count(*)::text || ' row(s)'
  FROM audit_logs
 WHERE action = 'LEGACY_PATH_WRITE'
   AND metadata ->> 'kind' = 'SETTLEMENT_AUCTION_LAUNCH'
 ORDER BY 1
;
