-- PHASE 4 — STEP 1 of 2: ESTABLISH. Read-only. Run this first, read every row, then decide.
--
-- OWNER-RUN, READ-ONLY. Safe under operation class 3 of the per-run protocol:
--
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f catalogue-purge-establish.sql
--
--
-- PROVEN, NOT ASSUMED. `catalogue-purge-rehearsal.sh` restores production's physical schema onto
-- a disposable loopback database, seeds a synthetic replica of the census, and runs this script
-- inside a server-enforced read-only transaction before running the delete. Both scripts have
-- been executed end to end; neither is handed over unrun.
-- WHY A PURGE IS PROPOSED AT ALL. The 221 rows in `inventory_items` were swept by the OLD
-- adapter, before the market was repointed to 76011 and before Phase 4 made the adapter ask
-- for the dealer and build objects. Read-only census, owner-run 2026-09-10:
--
--   * city / state / zip NULL on 207 and empty-string on 14. ZERO carry a state.
--   * rooftop_id NULL on all 221, and mc_rooftop_id NULL on all 221.
--   * newest created 2026-09-02, last updated 09-03 — eight days stale.
--
-- Those three facts are one fact: the rows have no geography, so `distanceMilesBetween`
-- returns null for every buyer, so `shortlistGate` fails CLOSED with DISTANCE_UNKNOWN and
-- offers REQUEST_SIMILAR. Not one of the 221 can be shortlisted by anyone, today, and none
-- can resolve to a rooftop. They are a catalogue that renders and cannot be acted on.
--
-- WHY NOT BACKFILL. Two reasons, and the second is the real one.
--   (1) Cost: the provider takes at most 10 VINs per call, so 221 VINs is 23 calls — 5.75%
--       of the 400/month budget. Real, but affordable; this is NOT the deciding reason.
--   (2) Geography: `external_dealer_state` is the tell. The old adapter DID write that
--       column while never writing the item's own `state`, and the repointed-market
--       migration records that "every ingested row in production carries
--       external_dealer_state='NY'". Query 2 below re-derives it rather than trusting that.
--       If it holds, backfilling produces 221 correctly-geocoded NEW YORK cars in a
--       Dallas-Fort Worth catalogue — every one of them out of radius, so every one still
--       renders as a card offering only the request path. That is not a cheaper fix than
--       the purge; it is the same broken screen with better data behind it.
--
-- WHAT ELSE POINTS AT THESE ROWS. Three physical foreign keys and four soft references.
-- Query 3 counts all seven. The two that BLOCK a delete:
--
--   shortlist_items.inventory_item_id   RESTRICT   (Phase 1 wave :978) — 15 rows
--   auction_vehicles.inventory_item_id  NO ACTION  (baseline 22-fks.sql:22 — no ON DELETE
--                                                   clause at all, which blocks like RESTRICT)
--
-- The auction_vehicles one is NOT named in the brief and blocks just as hard. One that does
-- not block but changes a business record silently:
--
--   vehicle_requests.inventory_item_id  SET NULL   (Phase 1 wave :936)
--
-- And four with NO physical foreign key, which the database will neither stop nor clean, so
-- a delete leaves orphans behind: vehicle_match_scores, inventory_price_alerts,
-- inventory_quality_scores, vehicle_request_match_results.
--
-- ════════════════════════════════════════════════════════════════════════════════════════

\echo '=== 1. The premise: how many rows, and do any of them carry usable geography? ==='
SELECT
  count(*)                                                           AS total_rows,
  count(*) FILTER (WHERE state IS NULL OR btrim(state) = '')         AS no_state,
  count(*) FILTER (WHERE zip   IS NULL OR btrim(zip)   = '')         AS no_zip,
  count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)      AS no_coordinates,
  count(*) FILTER (WHERE rooftop_id IS NULL)                         AS no_rooftop,
  count(*) FILTER (WHERE mc_rooftop_id IS NULL)                      AS no_mc_rooftop_id,
  count(*) FILTER (WHERE external_dealer_website IS NULL)            AS no_dealer_website,
  count(*) FILTER (WHERE is_active)                                  AS still_active,
  min(created_at)::date                                              AS oldest,
  max(created_at)::date                                              AS newest,
  max(last_seen_at)::date                                            AS last_seen
FROM inventory_items;

\echo ''
\echo '=== 2. The market these rows actually came from (the backfill argument stands or falls here) ==='
SELECT
  coalesce(external_dealer_state, '(null)') AS swept_from_state,
  count(*)                                  AS rows
FROM inventory_items
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo '=== 3. Reference census — what points at these rows, and which of it blocks a DELETE ==='
SELECT 'shortlist_items (RESTRICT — BLOCKS)'        AS reference,
       count(*)                                     AS rows,
       count(DISTINCT inventory_item_id)            AS distinct_listings
  FROM shortlist_items
UNION ALL
SELECT 'auction_vehicles (NO ACTION — BLOCKS)',
       count(*) FILTER (WHERE inventory_item_id IS NOT NULL),
       count(DISTINCT inventory_item_id)
  FROM auction_vehicles
UNION ALL
SELECT 'vehicle_requests (SET NULL — silently nulls)',
       count(*) FILTER (WHERE inventory_item_id IS NOT NULL),
       count(DISTINCT inventory_item_id)
  FROM vehicle_requests
UNION ALL
SELECT 'vehicle_match_scores (NO FK — orphans)',
       count(*), count(DISTINCT inventory_item_id) FROM vehicle_match_scores
UNION ALL
SELECT 'inventory_price_alerts (NO FK — orphans)',
       count(*), count(DISTINCT inventory_item_id) FROM inventory_price_alerts
UNION ALL
SELECT 'inventory_quality_scores (NO FK — orphans)',
       count(*), count(DISTINCT inventory_item_id) FROM inventory_quality_scores
UNION ALL
SELECT 'vehicle_request_match_results (NO FK — orphans)',
       count(*), count(DISTINCT inventory_item_id) FROM vehicle_request_match_results;

\echo ''
\echo '=== 4. THE DELETE SET. `deletable` is the number step 2 wants as -v expected_deletes ==='
-- The six predicates below are character-for-character the ones in catalogue-purge-delete.sql.
-- They must be, or the two scripts describe different sets and step 2 refuses a run in which
-- nothing has actually changed.
--
-- `defective_not_selected` is the reconciliation column, and it is precisely step 2's rollback
-- condition computed in advance: a row that still shows the defect (no state, no coordinates)
-- and that nothing blocking points at, but that escapes one of the six predicates — carrying an
-- mc_rooftop_id, say, or a zip with no state. If it is anything other than 0, step 2 will
-- REFUSE, because it will not half-apply a purge whose delete set is narrower than the defect it
-- was written for. Report the number and the rows; do not widen the predicates to absorb them.
--
-- A healthy row swept AFTER the fix is not counted here: it has a state and coordinates, so it
-- is neither doomed nor defective, and it is invisible to both this column and step 2.
SELECT
  count(*) FILTER (WHERE d.doomed)                          AS deletable,
  count(*) FILTER (WHERE d.referenced)                      AS retained_because_referenced,
  count(*) FILTER (WHERE NOT d.referenced AND NOT d.doomed
                     AND d.defective)                       AS defective_not_selected,
  count(*)                                                   AS total
FROM (
  SELECT
    (EXISTS (SELECT 1 FROM shortlist_items  s WHERE s.inventory_item_id = i.id)
     OR EXISTS (SELECT 1 FROM auction_vehicles a WHERE a.inventory_item_id = i.id)) AS referenced,
    (i.created_at < timestamp '2026-09-04 00:00:00'
     AND (i.state IS NULL OR btrim(i.state) = '')
     AND (i.zip   IS NULL OR btrim(i.zip)   = '')
     AND i.latitude IS NULL AND i.longitude IS NULL
     AND i.rooftop_id IS NULL AND i.mc_rooftop_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM shortlist_items  s WHERE s.inventory_item_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM auction_vehicles a WHERE a.inventory_item_id = i.id)) AS doomed,
    -- Character-for-character step 2's survivor assertion. `OR` on the coordinates, not
    -- `AND`: half a coordinate pair is not a location, and a row carrying one of the two
    -- would otherwise be invisible to both this column and the delete's own check.
    ((i.state IS NULL OR btrim(i.state) = '')
      AND (i.latitude IS NULL OR i.longitude IS NULL))                                   AS defective
  FROM inventory_items i
) d;

\echo ''
\echo '=== 5. The RETAINED rows, named. These stay, and Phase 4 revalidation handles them. ==='
SELECT
  i.id, i.year, i.make, i.model,
  i.external_dealer_state AS swept_from,
  i.last_seen_at::date    AS last_seen,
  (SELECT count(*) FROM shortlist_items  s WHERE s.inventory_item_id = i.id) AS on_shortlists,
  (SELECT count(*) FROM auction_vehicles a WHERE a.inventory_item_id = i.id) AS as_candidates
FROM inventory_items i
WHERE EXISTS (SELECT 1 FROM shortlist_items  s WHERE s.inventory_item_id = i.id)
   OR EXISTS (SELECT 1 FROM auction_vehicles a WHERE a.inventory_item_id = i.id)
ORDER BY on_shortlists DESC, as_candidates DESC, i.id;

\echo ''
\echo '=== 6. WHOSE shortlists — because these are buyer choices, not catalogue rows ==='
SELECT
  s.shortlist_id,
  sl.buyer_id,
  count(*)                                                      AS items_on_this_shortlist,
  count(*) FILTER (WHERE i.latitude IS NULL)                    AS items_with_no_location,
  (SELECT count(*) FROM deposits d
    WHERE d.buyer_id = sl.buyer_id AND d.status IN ('PAID','DISPUTED')) AS settled_deposits
FROM shortlist_items s
JOIN shortlists     sl ON sl.id = s.shortlist_id
JOIN inventory_items i ON i.id = s.inventory_item_id
GROUP BY s.shortlist_id, sl.buyer_id
ORDER BY settled_deposits DESC, items_on_this_shortlist DESC;
