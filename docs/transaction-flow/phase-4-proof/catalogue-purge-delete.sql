-- PHASE 4 — STEP 2 of 2: DELETE. Run ONLY after catalogue-purge-establish.sql, and only
-- after reading every row it printed.
--
-- OWNER-RUN. This is DML against business tables, which the per-run protocol in CLAUDE.md
-- does not authorize for an agent session under any of its three operation classes. It is
-- committed here so it can be reviewed before it is run — the convention preflight.sql,
-- verify.sql and d2-test-data-cleanup.sql already follow.
--
-- Run (both parameters are REQUIRED; the script refuses to guess either):
--
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 \
--     -v expected_deletes=<the `deletable` number from query 4 of the establish script> \
--     -f catalogue-purge-delete.sql
--
--
-- PROVEN, NOT ASSUMED. `catalogue-purge-rehearsal.sh` runs this script eleven ways on a restore
-- of production's physical schema: the four refusals, the real delete, the outcome assertions,
-- and the refusal on re-run. It has been executed end to end and is not handed over unrun.
-- ── WHAT THIS DELETES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────
--
-- DELETES: `inventory_items` rows that are ALL of — created before the cutoff, carrying no
-- state, no zip, no coordinates, no rooftop_id and no mc_rooftop_id, and pointed at by
-- nothing that blocks. Six predicates for one population, because a DELETE that is only as
-- narrow as its intent is a DELETE that widens the first time the intent is wrong.
--
-- RETAINS: every row on a buyer's shortlist (15) and every row standing as an auction
-- candidate (3). Deleting one of those removes something a BUYER chose. They are already
-- inert — `shortlistGate` fails closed on them with DISTANCE_UNKNOWN because they have no
-- coordinates — and Phase 4's `revalidateCandidate` is the designed handler: it drops a
-- candidate that fails revalidation on location, with a reason, in front of the buyer.
-- The blocking foreign keys are therefore not an obstacle to route around. They are the
-- database agreeing with the ruling.
--
-- ── THE ORDERING THAT MATTERS ───────────────────────────────────────────────────────────
--
-- Run this AFTER a successful sweep has landed the first Arlington rows, not before. The
-- new rows are VIN-keyed and insert alongside the old ones, so there is then no window in
-- which the catalogue is empty. Purging first would leave the buyer looking at zero results
-- until 08:00 UTC the next morning — and a zero-result screen is exactly the failure mode
-- Phase 4 was told never to render.
--
-- The script enforces it: with no geocoded listing present it refuses. Pass
-- `-v allow_empty_catalogue=1` to override deliberately.
--
-- ── WHAT ELSE POINTS AT inventory_items ─────────────────────────────────────────────────
--
--   shortlist_items.inventory_item_id    RESTRICT   (Phase 1 wave migration.sql:978)  BLOCKS
--   auction_vehicles.inventory_item_id   NO ACTION  (baseline 22-fks.sql:22)          BLOCKS
--   vehicle_requests.inventory_item_id   SET NULL   (Phase 1 wave migration.sql:936)  SILENT
--   vehicle_match_scores                 no FK      orphans
--   inventory_price_alerts               no FK      orphans
--   inventory_quality_scores             no FK      orphans
--   vehicle_request_match_results        no FK      orphans
--
-- The two that BLOCK are handled by not deleting what they reference. The one that is
-- SILENT is handled explicitly below rather than left to the FK: `updated_at` is maintained
-- by Prisma's @updatedAt, not by the database, so an FK-driven SET NULL would change a
-- business record and leave the row claiming it had not changed. The four with no FK are
-- deleted in this same transaction, because nothing else ever will.
--
-- ── NO audit_logs ROW, AND WHY ──────────────────────────────────────────────────────────
--
-- `audit_logs.action` is the `AdminActionType` enum, which has no DELETE member. Writing
-- STATUS_CHANGE would put a false statement in the audit trail to satisfy a convention, and
-- adding an enum member is DDL, which belongs in a migration and not in a cleanup script.
-- So the record of this run is: the NOTICE block below (which names every deleted id), the
-- run output the per-run protocol already requires be reported in full, and a
-- `vehicle_request_events` row for every request whose listing reference is cleared —
-- `event_type` there is a free string, so it can say what actually happened.
--
-- ── FAILS CLOSED ────────────────────────────────────────────────────────────────────────
--
-- Every count is asserted before COMMIT and any mismatch raises, rolling the whole
-- transaction back. In particular: if the selected count is not exactly the number the
-- establish script printed, NOTHING is deleted. A mismatch means the catalogue moved
-- between the two runs — re-run the establish script and read it again. Do not adjust the
-- parameter to make the assertion pass.

\if :{?expected_deletes}
\else
  \set expected_deletes -1
\endif

\if :{?cutoff}
\else
  -- Newest row in the doomed population was created 2026-09-02 and last updated 09-03.
  -- Naive, not timestamptz: `inventory_items.created_at` is `timestamp without time zone`
  -- (Prisma stores UTC), and a timestamptz parameter would be converted through whatever
  -- the session's TimeZone happens to be.
  \set cutoff '2026-09-04 00:00:00'
\endif

\if :{?allow_empty_catalogue}
\else
  \set allow_empty_catalogue 0
\endif

BEGIN;

-- psql substitutes variables in ordinary statements but NOT inside dollar-quoted bodies,
-- so the parameters are landed in a table the DO blocks can read.
CREATE TEMP TABLE _params ON COMMIT DROP AS
SELECT :expected_deletes::int         AS expected_deletes,
       :'cutoff'::timestamp           AS cutoff,
       (:allow_empty_catalogue <> 0)  AS allow_empty_catalogue;

DO $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM _params;
  IF p.expected_deletes < 0 THEN
    RAISE EXCEPTION 'missing -v expected_deletes=<N>: pass the `deletable` count from query 4 of catalogue-purge-establish.sql. Nothing deleted.';
  END IF;
END $$;

-- ── PRECONDITION: a working catalogue exists to purge INTO ──────────────────────────────
DO $$
DECLARE p record; n_geocoded int;
BEGIN
  SELECT * INTO p FROM _params;
  SELECT count(*) INTO n_geocoded
    FROM inventory_items
   WHERE is_active
     AND state IS NOT NULL AND btrim(state) <> ''
     AND latitude IS NOT NULL AND longitude IS NOT NULL;

  IF n_geocoded = 0 AND NOT p.allow_empty_catalogue THEN
    RAISE EXCEPTION
      'no geocoded active listing exists yet — a successful sweep has not landed. Purging now leaves the buyer with an empty catalogue until the next 08:00 UTC run. Re-run after a green sweep, or pass -v allow_empty_catalogue=1 deliberately. Nothing deleted.';
  END IF;
  RAISE NOTICE 'precondition: % geocoded active listing(s) present', n_geocoded;
END $$;

-- ── BEFORE counts, captured so the assertions can prove nothing else moved ──────────────
CREATE TEMP TABLE _before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM inventory_items)  AS inventory_items,
       (SELECT count(*) FROM shortlist_items)  AS shortlist_items,
       (SELECT count(*) FROM auction_vehicles) AS auction_vehicles;

-- ── THE DOOMED SET ──────────────────────────────────────────────────────────────────────
-- Six predicates. Any one of them false and the row survives.
CREATE TEMP TABLE _doomed ON COMMIT DROP AS
SELECT i.id, i.vin, i.year, i.make, i.model,
       i.external_dealer_state, i.created_at
FROM inventory_items i, _params p
WHERE i.created_at < p.cutoff
  AND (i.state IS NULL OR btrim(i.state) = '')
  AND (i.zip   IS NULL OR btrim(i.zip)   = '')
  AND i.latitude IS NULL
  AND i.longitude IS NULL
  AND i.rooftop_id IS NULL
  AND i.mc_rooftop_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM shortlist_items  s WHERE s.inventory_item_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM auction_vehicles a WHERE a.inventory_item_id = i.id);

-- Which predicate narrowed the set, printed BEFORE the assertion so a mismatch is
-- diagnosable from this run's own output instead of a second trip.
\echo ''
\echo '=== predicate breakdown (read this if the count assertion below fails) ==='
SELECT (SELECT count(*) FROM inventory_items)                                                        AS all_rows,
       (SELECT count(*) FROM inventory_items i, _params p WHERE i.created_at < p.cutoff)             AS before_cutoff,
       (SELECT count(*) FROM inventory_items WHERE state IS NULL OR btrim(state) = '')               AS no_state,
       (SELECT count(*) FROM inventory_items WHERE zip IS NULL OR btrim(zip) = '')                   AS no_zip,
       (SELECT count(*) FROM inventory_items WHERE latitude IS NULL AND longitude IS NULL)           AS no_coordinates,
       (SELECT count(*) FROM inventory_items WHERE rooftop_id IS NULL AND mc_rooftop_id IS NULL)     AS no_rooftop,
       (SELECT count(*) FROM inventory_items i
         WHERE EXISTS (SELECT 1 FROM shortlist_items s WHERE s.inventory_item_id = i.id)
            OR EXISTS (SELECT 1 FROM auction_vehicles a WHERE a.inventory_item_id = i.id))           AS referenced,
       (SELECT count(*) FROM _doomed)                                                                AS selected;

DO $$
DECLARE p record; n int;
BEGIN
  SELECT * INTO p FROM _params;
  SELECT count(*) INTO n FROM _doomed;
  IF n <> p.expected_deletes THEN
    RAISE EXCEPTION
      'selected % rows, expected % — the catalogue moved between the establish run and this one, or a predicate is narrower than the establish query. Re-run catalogue-purge-establish.sql and read query 4 again; do NOT change the parameter to fit. Nothing deleted.',
      n, p.expected_deletes;
  END IF;
END $$;

-- ── 1. Vehicle requests pointing at a doomed listing ────────────────────────────────────
CREATE TEMP TABLE _affected_requests ON COMMIT DROP AS
SELECT r.id AS request_id, r.status::text AS status, r.inventory_item_id
FROM vehicle_requests r
JOIN _doomed d ON d.id = r.inventory_item_id;

UPDATE vehicle_requests r
   SET inventory_item_id = NULL,
       updated_at        = now()
  FROM _affected_requests a
 WHERE r.id = a.request_id;

INSERT INTO vehicle_request_events (id, request_id, event_type, actor_id, actor_role, note, payload, created_at)
SELECT gen_random_uuid()::text, a.request_id, 'inventory_listing_purged', NULL, 'admin',
       'The swept listing this request referenced was removed: it carried no geography, could not resolve to a rooftop, and could not be shortlisted or revalidated by anyone. The request itself is untouched.',
       jsonb_build_object(
         'inventory_item_id', a.inventory_item_id,
         'request_status_at_purge', a.status,
         'reason', 'phase-4-catalogue-purge',
         'ruling', 'owner decision 2026-09-10: purge the ungeocoded pre-repoint sweep rather than backfill'
       ),
       now()
FROM _affected_requests a;

-- ── 2. The four soft references. No foreign key exists, so nothing else will ever ───────
--       clean these up, and every one of them would otherwise point at a dead id.
DELETE FROM vehicle_match_scores         v USING _doomed d WHERE v.inventory_item_id = d.id;
DELETE FROM inventory_price_alerts       v USING _doomed d WHERE v.inventory_item_id = d.id;
DELETE FROM inventory_quality_scores     v USING _doomed d WHERE v.inventory_item_id = d.id;
DELETE FROM vehicle_request_match_results v USING _doomed d WHERE v.inventory_item_id = d.id;

-- ── 3. The listings ─────────────────────────────────────────────────────────────────────
DELETE FROM inventory_items i USING _doomed d WHERE i.id = d.id;

-- ── ASSERTIONS ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  b record; n_doomed int; n_left int; n_remaining int; n_unreferenced int;
  n_sl int; n_av int; n_events int; n_orphans int; n_req_left int; n_affected int;
BEGIN
  SELECT * INTO b FROM _before;
  SELECT count(*) INTO n_doomed FROM _doomed;
  SELECT count(*) INTO n_affected FROM _affected_requests;

  -- Every doomed row is gone.
  SELECT count(*) INTO n_left FROM inventory_items i JOIN _doomed d ON d.id = i.id;
  IF n_left <> 0 THEN
    RAISE EXCEPTION '% doomed row(s) still present after the delete — rolling back', n_left;
  END IF;

  -- Exactly the doomed rows are gone, and nothing else.
  SELECT count(*) INTO n_remaining FROM inventory_items;
  IF n_remaining <> b.inventory_items - n_doomed THEN
    RAISE EXCEPTION 'inventory_items went % -> %, expected % — rolling back',
      b.inventory_items, n_remaining, b.inventory_items - n_doomed;
  END IF;

  -- Everything that survives survives for a reason a human can state.
  SELECT count(*) INTO n_unreferenced
    FROM inventory_items i
   WHERE NOT EXISTS (SELECT 1 FROM shortlist_items  s WHERE s.inventory_item_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM auction_vehicles a WHERE a.inventory_item_id = i.id)
     AND (i.state IS NULL OR btrim(i.state) = '')
     -- OR, not AND. A row carrying a latitude with a NULL longitude is just as unplaceable
     -- as one carrying neither — `distanceMilesBetween` needs both — but an AND here called
     -- it healthy, so it was neither doomed by the six predicates nor caught by this
     -- assertion, and it would have survived the purge silently still showing the defect.
     AND (i.latitude IS NULL OR i.longitude IS NULL);
  IF n_unreferenced <> 0 THEN
    RAISE EXCEPTION
      '% ungeocoded, unreferenced listing(s) survived the purge — the delete set was narrower than the defect it was written for; rolling back so the discrepancy can be read rather than half-applied',
      n_unreferenced;
  END IF;

  -- No buyer lost anything.
  SELECT count(*) INTO n_sl FROM shortlist_items;
  SELECT count(*) INTO n_av FROM auction_vehicles;
  IF n_sl <> b.shortlist_items OR n_av <> b.auction_vehicles THEN
    RAISE EXCEPTION 'shortlist_items % -> %, auction_vehicles % -> %; a buyer-owned row moved and must not have — rolling back',
      b.shortlist_items, n_sl, b.auction_vehicles, n_av;
  END IF;

  -- The SET NULL was made visible, one event per affected request.
  SELECT count(*) INTO n_events
    FROM vehicle_request_events e JOIN _affected_requests a ON a.request_id = e.request_id
   WHERE e.event_type = 'inventory_listing_purged' AND e.created_at >= now() - interval '1 minute';
  IF n_events <> n_affected THEN
    RAISE EXCEPTION 'wrote % events for % affected requests — rolling back', n_events, n_affected;
  END IF;

  SELECT count(*) INTO n_req_left FROM vehicle_requests r JOIN _doomed d ON d.id = r.inventory_item_id;
  IF n_req_left <> 0 THEN
    RAISE EXCEPTION '% vehicle_request(s) still reference a deleted listing — rolling back', n_req_left;
  END IF;

  -- No orphan survives in a table the database does not police.
  SELECT (SELECT count(*) FROM vehicle_match_scores v          WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = v.inventory_item_id))
       + (SELECT count(*) FROM inventory_price_alerts v        WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = v.inventory_item_id))
       + (SELECT count(*) FROM inventory_quality_scores v      WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = v.inventory_item_id))
       + (SELECT count(*) FROM vehicle_request_match_results v WHERE v.inventory_item_id IS NOT NULL
                                                                 AND NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = v.inventory_item_id))
    INTO n_orphans;
  IF n_orphans <> 0 THEN
    RAISE EXCEPTION '% orphaned soft reference(s) remain — rolling back', n_orphans;
  END IF;

  RAISE NOTICE 'CHECKED: deleted % listing(s); % remain (referenced by a buyer, or geocoded and current); % request(s) cleared and evented; 0 orphans; shortlist_items % and auction_vehicles % unchanged',
    n_doomed, n_remaining, n_affected, n_sl, n_av;
END $$;

-- The record of exactly what went. Read it in the run output; there is no audit_logs row.
\echo ''
\echo '=== deleted listings (this output IS the record — report it in full) ==='
SELECT id, vin, year, make, model, external_dealer_state AS swept_from, created_at::date
FROM _doomed ORDER BY created_at, id;

\echo ''
\echo '=== requests whose listing reference was cleared ==='
SELECT request_id, status, inventory_item_id AS was_pointing_at FROM _affected_requests ORDER BY request_id;

COMMIT;
