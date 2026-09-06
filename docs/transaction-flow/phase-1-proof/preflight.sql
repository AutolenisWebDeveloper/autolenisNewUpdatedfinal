-- Phase 1 DEPLOY-TIME preflight. Run read-only against PRODUCTION immediately before
-- `prisma migrate deploy`, after §13-D1 and §13-D2 and inside the same maintenance window.
--
-- CONTRACT, identical in shape to `verify.sql`:
--     PASS  <=>  no row has status = 'BLOCK'
-- Exactly one row has status 'CHECKED' and reports how many preconditions ran. A silent zero-row
-- result is NOT a pass — it means the query did not run. Every other row is one BLOCK naming a
-- record that must be reconciled by an owner-run, audited change BEFORE the migration is applied.
-- Never by migration SQL: a migration that repairs its own preconditions with an UPDATE is a
-- migration that hides them.
--
-- WHY THIS FILE EXISTS. Two statements in the wave can fail against DATA rather than against schema,
-- and a row count measured during review does not bind at deploy time. §5.7 records
-- `vehicle_requests.assigned_admin_id` as holding 0 non-NULL rows when it was read on 2026-09-05;
-- that is an observation, not a property of the column. One admin assignment between that
-- observation and the deploy makes `ADD CONSTRAINT … REFERENCES admins(id)` fail mid-migration —
-- and Prisma runs the file in one transaction, so the whole wave rolls back. The same reasoning is
-- why §13-D2 exists for the unique index. Both are asserted here, at deploy time, against the data
-- that will actually be there.
--
-- Read-only: pure SELECTs, no DDL, no DML.

WITH
-- §13-D11 correction 1 / R2. `queue_items.assigned_admin_id` needs no row here: the table does not
-- exist in production (§5.2), so the wave creates it empty and its FK validates an empty set by
-- construction. `vehicle_requests.assigned_admin_id` is the live column, and it is retargeted from
-- nothing to `admins(id)` — so every non-NULL value must already resolve there.
fk_violations AS (
  SELECT vr.id AS vehicle_request_id, vr.assigned_admin_id AS unresolvable_admin_id
  FROM vehicle_requests vr
  WHERE vr.assigned_admin_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.id = vr.assigned_admin_id)
),
-- The preconditions this file asserts, named once so the CHECKED count is derived from them.
preconditions(name) AS (VALUES
  ('fk:vehicle_requests_assigned_admin_id_fkey'),
  ('index:vehicle_requests_one_open_per_buyer_key')
),
-- §13-D2 / §5.6. The predicate is the one `vehicle_requests_one_open_per_buyer_key` uses, and it is
-- kept in lockstep with the index in `20261106000100_transaction_spine_foundation/migration.sql`:
-- if one changes and the other does not, this preflight stops asserting the right thing.
--
-- `status::text`, NOT `status`, and this is not a style choice. This file runs BEFORE
-- `prisma migrate deploy`, so `VehicleRequestStatus` does not yet carry `DRAFT`,
-- `PAYMENT_REQUIRED` or `RADIUS_AUTHORIZATION_REQUIRED` — directory 1 adds them. Comparing the enum
-- against a label it does not have yet is a 22P02 that aborts the whole preflight, so the one query
-- meant to protect the deploy would fail to run at all. Casting to text compares the labels that do
-- exist and silently ignores the three that do not, which is exactly right: no row can be in a state
-- that has not been created yet. The index in directory 2 keeps the enum comparison, because by then
-- directory 1 has committed the labels.
open_request_violations AS (
  SELECT buyer_id, count(*) AS open_requests
  FROM vehicle_requests
  WHERE status::text IN (
    'DRAFT','SUBMITTED','INTAKE','PAYMENT_REQUIRED','ACTIVE_SOURCING','RADIUS_AUTHORIZATION_REQUIRED',
    'OFFER_READY','OFFER_SENT','OFFER_ACCEPTED','OFFER_DECLINED')
  GROUP BY buyer_id
  HAVING count(*) > 1
)
SELECT 'BLOCK' AS status,
       'fk:vehicle_requests_assigned_admin_id_fkey' AS precondition,
       'vehicle_request ' || vehicle_request_id || ' has assigned_admin_id ' || unresolvable_admin_id
         || ' which is not an admins(id). Reconcile it (it is an Admin.id, never a User.id) or clear '
         || 'it before deploying; ADD CONSTRAINT will otherwise abort the whole wave.' AS detail
  FROM fk_violations
UNION ALL
SELECT 'BLOCK',
       'index:vehicle_requests_one_open_per_buyer_key',
       'buyer ' || buyer_id || ' holds ' || open_requests || ' open vehicle requests. §13-D2: an '
         || 'owner-run audited cancellation of the superseded rows must land first; the unique index '
         || 'cannot be created while this returns rows.'
  FROM open_request_violations
-- Positive evidence: what this run actually asserted. Always exactly one row, and the number is
-- COMPUTED from the list below rather than typed, so adding a third precondition without updating a
-- literal cannot leave this file reporting 2 while asserting 3.
UNION ALL
SELECT 'CHECKED', 'preconditions_asserted', (SELECT count(*)::text FROM preconditions)
ORDER BY 1, 2, 3;
