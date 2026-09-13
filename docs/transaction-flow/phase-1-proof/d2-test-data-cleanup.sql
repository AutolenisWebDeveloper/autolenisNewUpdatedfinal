-- §13-D2 — cancel the duplicate open Vehicle Requests so the one-open-per-buyer
-- index can be created.
--
-- OWNER-RUN. This is DML against business tables, which the per-run protocol in
-- CLAUDE.md does not authorize for an agent session under any of its three
-- operation classes. It is committed here so it can be reviewed before it is run,
-- which is the convention preflight.sql and verify.sql already follow.
--
-- PROVENANCE, STATED PLAINLY. This file was written fresh on 2026-09-08 to the
-- requirements in the D2 ruling (original status captured before the update,
-- events and audit rows written, four counts agreeing before COMMIT,
-- cancel_reason = 'test-data-cleanup'). It is NOT the "corrected Option B SQL"
-- reviewed in an earlier session — that artifact is not in this session's context
-- and is not committed anywhere in this repository. Re-review it as new.
--
-- WHAT THE RULING SETTLED. All three buyers and all their deposits are the
-- owner's test data, not real customers. No refunds, no §23.1 review, and no
-- judgment about which request "should" survive: the oldest per buyer is kept
-- purely so the rows stay coherent, and the choice is arbitrary because none
-- represents a real buyer intent. `cancel_reason` is therefore
-- 'test-data-cleanup', NOT 'superseded-duplicate-request' — the latter would
-- read as a customer incident in the record.
--
-- EXPECTED: 4 open -> cancel 3 (053d546b), 5 -> cancel 4 (70568e7b),
--           2 -> cancel 1 (dd2411be). EIGHT rows cancelled in total.
--
-- FAILS CLOSED. Every count is asserted before COMMIT and any mismatch raises,
-- which rolls the whole transaction back. A buyer-id prefix that matches zero or
-- more than one buyer also raises: the ids below are the 8-character prefixes as
-- given, and a collision must stop the run rather than cancel the wrong rows.
--
-- Run:
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 -f d2-test-data-cleanup.sql

BEGIN;

-- The ten statuses the partial unique index counts as open. Character-for-character
-- the predicate in 20261106000100_transaction_spine_foundation; a request in any
-- other status is already not competing for the index.
CREATE TEMP TABLE _open_statuses(status "VehicleRequestStatus") ON COMMIT DROP;
INSERT INTO _open_statuses VALUES
  ('DRAFT'),('SUBMITTED'),('INTAKE'),('PAYMENT_REQUIRED'),('ACTIVE_SOURCING'),
  ('RADIUS_AUTHORIZATION_REQUIRED'),('OFFER_READY'),('OFFER_SENT'),
  ('OFFER_ACCEPTED'),('OFFER_DECLINED');

-- Resolve the three prefixes to exactly three buyers, or stop.
CREATE TEMP TABLE _targets(buyer_id text PRIMARY KEY, prefix text, expected_cancels int) ON COMMIT DROP;
INSERT INTO _targets(buyer_id, prefix, expected_cancels)
SELECT b.id, t.prefix, t.expected_cancels
FROM (VALUES ('053d546b', 3), ('70568e7b', 4), ('dd2411be', 1)) AS t(prefix, expected_cancels)
JOIN buyers b ON b.id LIKE t.prefix || '%';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _targets;
  IF n <> 3 THEN
    RAISE EXCEPTION 'buyer prefixes resolved to % buyers, expected exactly 3 — a prefix is ambiguous or absent; nothing cancelled', n;
  END IF;
END $$;

-- Capture the doomed rows AND their ORIGINAL status before anything is written.
-- The survivor is the OLDEST open request per buyer; ties break on id so the set
-- is deterministic if two rows share created_at.
CREATE TEMP TABLE _doomed AS
SELECT vr.id, vr.buyer_id, vr.status AS original_status, vr.created_at
FROM (
  SELECT r.id, r.buyer_id, r.status, r.created_at,
         row_number() OVER (PARTITION BY r.buyer_id ORDER BY r.created_at ASC, r.id ASC) AS rn
  FROM vehicle_requests r
  JOIN _targets t ON t.buyer_id = r.buyer_id
  WHERE r.status IN (SELECT status FROM _open_statuses)
) vr
WHERE vr.rn > 1;

-- COUNT 1 — selected for cancellation, per buyer, against the ruling's figures.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s: selected %s, expected %s', t.prefix, coalesce(d.n, 0), t.expected_cancels), '; ')
    INTO bad
  FROM _targets t
  LEFT JOIN (SELECT buyer_id, count(*) AS n FROM _doomed GROUP BY buyer_id) d ON d.buyer_id = t.buyer_id
  WHERE coalesce(d.n, 0) <> t.expected_cancels;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'open-request counts do not match the ruling — %; nothing cancelled', bad;
  END IF;
END $$;

-- The write. `updated_at` is set explicitly: @updatedAt is applied by Prisma, not
-- by the database, so raw SQL must maintain it or the row would lie about when it
-- last changed.
UPDATE vehicle_requests r
   SET status        = 'CANCELLED',
       cancelled_at  = now(),
       cancel_reason = 'test-data-cleanup',
       updated_at    = now()
  FROM _doomed d
 WHERE r.id = d.id;

-- The event trail, one row per cancellation, carrying the ORIGINAL status.
INSERT INTO vehicle_request_events (id, request_id, event_type, actor_id, actor_role, note, payload, created_at)
SELECT gen_random_uuid()::text, d.id, 'request_cancelled', NULL, 'admin',
       'Test-data cleanup for the one-open-per-buyer index (§13-D2). Not a customer cancellation.',
       jsonb_build_object(
         'reason', 'test-data-cleanup',
         'original_status', d.original_status,
         'decision', 'owner ruling 2026-09-08: test data, no refund, no §23.1 review',
         'survivor_rule', 'oldest open request per buyer retained; choice arbitrary'
       ),
       now()
FROM _doomed d;

-- The audit trail.
INSERT INTO audit_logs (id, admin_id, user_id, action, entity_type, entity_id, reason, metadata, created_at)
SELECT gen_random_uuid()::text, NULL, NULL, 'CANCEL', 'VehicleRequest', d.id,
       'Test-data cleanup (§13-D2, owner ruling 2026-09-08) — not a customer cancellation',
       jsonb_build_object('original_status', d.original_status, 'cancel_reason', 'test-data-cleanup'),
       now()
FROM _doomed d;

-- COUNTS 2, 3 and 4 — updated rows, event rows, audit rows — must all equal the
-- selected count, and the index precondition must now actually hold.
DO $$
DECLARE
  n_doomed int; n_cancelled int; n_events int; n_audit int; n_still_open int;
BEGIN
  SELECT count(*) INTO n_doomed FROM _doomed;

  SELECT count(*) INTO n_cancelled
    FROM vehicle_requests r JOIN _doomed d ON d.id = r.id
   WHERE r.status = 'CANCELLED' AND r.cancel_reason = 'test-data-cleanup';

  SELECT count(*) INTO n_events
    FROM vehicle_request_events e JOIN _doomed d ON d.id = e.request_id
   WHERE e.event_type = 'request_cancelled' AND e.created_at >= now() - interval '1 minute';

  SELECT count(*) INTO n_audit
    FROM audit_logs a JOIN _doomed d ON a.entity_id = d.id
   WHERE a.action = 'CANCEL' AND a.created_at >= now() - interval '1 minute';

  IF n_doomed <> 8 THEN
    RAISE EXCEPTION 'expected 8 cancellations in total, selected % — rolling back', n_doomed;
  END IF;
  IF n_cancelled <> n_doomed OR n_events <> n_doomed OR n_audit <> n_doomed THEN
    RAISE EXCEPTION 'counts disagree: selected %, cancelled %, events %, audit % — rolling back',
      n_doomed, n_cancelled, n_events, n_audit;
  END IF;

  -- The whole point: no buyer may still hold more than one open request.
  SELECT count(*) INTO n_still_open FROM (
    SELECT r.buyer_id FROM vehicle_requests r
     WHERE r.status IN (SELECT status FROM _open_statuses)
     GROUP BY r.buyer_id HAVING count(*) > 1
  ) x;
  IF n_still_open <> 0 THEN
    RAISE EXCEPTION '% buyer(s) still hold more than one open request — the index would still fail; rolling back', n_still_open;
  END IF;

  RAISE NOTICE 'CHECKED: % cancelled, % events, % audit rows, 0 buyers with multiple open requests',
    n_cancelled, n_events, n_audit;
END $$;

COMMIT;
