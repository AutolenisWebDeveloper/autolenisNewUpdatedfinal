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
-- The four keys added to live tables that already hold data. Each is guarded for the same reason as
-- `assigned_admin_id`: `ADD CONSTRAINT` validates existing rows, Prisma runs the file in ONE
-- transaction, and a single orphan therefore rolls back the entire wave mid-deploy. A row count taken
-- during review does not bind at deploy time; these run against the data that will actually be there.
orphan_buyer_opportunity AS (
  SELECT vr.id AS child_id, vr.buyer_opportunity_id AS missing_parent
  FROM vehicle_requests vr
  WHERE vr.buyer_opportunity_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM buyer_opportunities p WHERE p.id = vr.buyer_opportunity_id)
),
orphan_pre_approval_document AS (
  SELECT d.id AS child_id, d.pre_approval_id AS missing_parent
  FROM external_pre_approval_documents d
  WHERE d.pre_approval_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM external_pre_approvals p WHERE p.id = d.pre_approval_id)
),
orphan_deal_status_history AS (
  SELECT h.id AS child_id, h.deal_id AS missing_parent
  FROM deal_status_history h
  WHERE h.deal_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM deals p WHERE p.id = h.deal_id)
),
orphan_shortlist_item AS (
  SELECT i.id AS child_id, i.inventory_item_id AS missing_parent
  FROM shortlist_items i
  WHERE i.inventory_item_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM inventory_items p WHERE p.id = i.inventory_item_id)
),
-- R30. §5.1 recorded 0 `deals` rows on 2026-09-05. Same argument as every other row here: that is a
-- measurement taken before the deploy, not a property of the table. One Deal written from a legacy
-- path between the reading and the deploy makes `ADD CONSTRAINT … CHECK` abort the wave.
deals_without_offer_lineage AS (
  SELECT d.id AS deal_id FROM deals d
  WHERE d.offer_id IS NULL AND d.vehicle_request_offer_id IS NULL
),
-- The preconditions this file asserts, named once so the CHECKED count is derived from them.
preconditions(name) AS (VALUES
  ('fk:vehicle_requests_assigned_admin_id_fkey'),
  ('index:vehicle_requests_one_open_per_buyer_key'),
  ('fk:vehicle_requests_buyer_opportunity_id_fkey'),
  ('fk:external_pre_approval_documents_pre_approval_id_fkey'),
  ('fk:deal_status_history_deal_id_fkey'),
  ('fk:shortlist_items_inventory_item_id_fkey'),
  ('check:deals_offer_lineage_check')
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
UNION ALL
SELECT 'BLOCK', 'fk:vehicle_requests_buyer_opportunity_id_fkey',
       'vehicle_request ' || child_id || ' points at buyer_opportunity ' || missing_parent
         || ' which does not exist. Clear the column or restore the parent before deploying.'
  FROM orphan_buyer_opportunity
UNION ALL
SELECT 'BLOCK', 'fk:external_pre_approval_documents_pre_approval_id_fkey',
       'external_pre_approval_document ' || child_id || ' points at external_pre_approval '
         || missing_parent || ' which does not exist. Reconcile before deploying.'
  FROM orphan_pre_approval_document
UNION ALL
SELECT 'BLOCK', 'fk:deal_status_history_deal_id_fkey',
       'deal_status_history ' || child_id || ' points at deal ' || missing_parent
         || ' which does not exist. Reconcile before deploying.'
  FROM orphan_deal_status_history
UNION ALL
SELECT 'BLOCK', 'fk:shortlist_items_inventory_item_id_fkey',
       'shortlist_item ' || child_id || ' points at inventory_item ' || missing_parent
         || ' which does not exist. Reconcile before deploying.'
  FROM orphan_shortlist_item
UNION ALL
SELECT 'BLOCK', 'check:deals_offer_lineage_check',
       'deal ' || deal_id || ' has neither offer_id nor vehicle_request_offer_id. R30 requires every '
         || 'Deal to be reachable from an offer; give it its lineage before deploying.'
  FROM deals_without_offer_lineage
-- Positive evidence: what this run actually asserted. Always exactly one row, and the number is
-- COMPUTED from the list below rather than typed, so adding a third precondition without updating a
-- literal cannot leave this file reporting 2 while asserting 3.
UNION ALL
SELECT 'CHECKED', 'preconditions_asserted', (SELECT count(*)::text FROM preconditions)
ORDER BY 1, 2, 3;
