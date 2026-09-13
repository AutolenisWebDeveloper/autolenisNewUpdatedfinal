-- Phase 1 wave ENUM census. Read-only. Run inside the server-enforced read-only transaction:
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-1-proof/enum-census.sql
--
-- WHY THIS FILE EXISTS. `verify.sql` asserts 49 wave enum labels by name and the cardinality of only
-- two types (`QueueItemType`, `QueueOwnerRole`). The foundation migration guards each `CREATE TYPE`
-- with its own `to_regtype(…) IS NULL`, so a type that already exists with a PARTIAL label set has
-- its CREATE skipped and the missing labels are never added — silently, with no error and no
-- statement to fail. This file closes that gap: it asserts every type of the wave, every one of its
-- labels by name, and the exact post-wave label count of each.
--
-- CONTRACT, identical in shape to `verify.sql` and `preflight.sql`:
--     PASS  <=>  no row has status = 'MISSING'
-- Exactly one row has status 'CHECKED' and reports how many assertions ran. A silent, zero-row
-- result is NOT a pass — it means the query did not run.
--
-- Generated from the migration source, not transcribed:
--   9 types CREATE'd by 20261106000100_transaction_spine_foundation (39 labels)
--   8 types EXTENDED by 20261106000000_transaction_spine_enums (41 ADD VALUE)
-- Post-wave totals for the 8 extended types are `schema.prisma` HEAD counts, which reconcile with
-- WORKFLOW §5.3's production baseline plus this wave's additions.
WITH expected_types(typname, n) AS (VALUES
  -- created by the foundation migration
  ('VehicleRequestEntryType',2),
  ('DeliveryPreference',2),
  ('AuctionInvitationStatus',10),
  ('DealerReaffirmationStatus',5),
  ('PostCompletionObligationStatus',3),
  ('AuctionVehicleCandidateStatus',5),
  ('ESignSignerKind',2),
  ('SourcingCandidateSource',2),
  ('QueueOwnerRole',8),
  -- extended by the enums migration; n is the TOTAL label count after the wave
  ('AdminActionType',10),
  ('DealStatus',23),
  ('FinancingAuditEventType',17),
  ('FinancingStatus',11),
  ('InsuranceStatus',11),
  ('PickupStatus',10),
  ('QueueItemType',20),
  ('VehicleRequestStatus',14)
), expected_labels(typname, label) AS (VALUES
  ('VehicleRequestEntryType','INVENTORY_SELECTION'),('VehicleRequestEntryType','CUSTOM_REQUEST'),('DeliveryPreference','PICKUP'),
  ('DeliveryPreference','DELIVERY'),('AuctionInvitationStatus','QUEUED'),('AuctionInvitationStatus','SENT'),
  ('AuctionInvitationStatus','DELIVERED'),('AuctionInvitationStatus','OPENED'),('AuctionInvitationStatus','BOUNCED'),
  ('AuctionInvitationStatus','DECLINED'),('AuctionInvitationStatus','RESPONDED'),('AuctionInvitationStatus','OFFER_SUBMITTED'),
  ('AuctionInvitationStatus','EXPIRED'),('AuctionInvitationStatus','REPLACED'),('DealerReaffirmationStatus','PENDING'),
  ('DealerReaffirmationStatus','CONFIRMED'),('DealerReaffirmationStatus','REJECTED'),('DealerReaffirmationStatus','TIMED_OUT'),
  ('DealerReaffirmationStatus','MATERIAL_CHANGE_PENDING'),('PostCompletionObligationStatus','PENDING'),('PostCompletionObligationStatus','OVERDUE'),
  ('PostCompletionObligationStatus','RESOLVED'),('AuctionVehicleCandidateStatus','ACTIVE'),('AuctionVehicleCandidateStatus','DROPPED'),
  ('AuctionVehicleCandidateStatus','SELECTED'),('AuctionVehicleCandidateStatus','CLOSED'),('AuctionVehicleCandidateStatus','REVALIDATION_PENDING'),
  ('ESignSignerKind','BUYER'),('ESignSignerKind','CO_BUYER'),('SourcingCandidateSource','HOLDING'),
  ('SourcingCandidateSource','COMPARABLE'),('QueueOwnerRole','OPERATIONS'),('QueueOwnerRole','BUYER'),
  ('QueueOwnerRole','FINANCE'),('QueueOwnerRole','SYSTEM'),('QueueOwnerRole','BUYER_OPERATIONS'),
  ('QueueOwnerRole','COMPLIANCE'),('QueueOwnerRole','OPERATIONS_FINANCE'),('QueueOwnerRole','BUYER_DEALER'),
  ('VehicleRequestStatus','DRAFT'),('VehicleRequestStatus','PAYMENT_REQUIRED'),('VehicleRequestStatus','RADIUS_AUTHORIZATION_REQUIRED'),
  ('DealStatus','DEALER_CONFIRMATION'),('DealStatus','RECAP_PENDING'),('DealStatus','DEALER_EXECUTED'),
  ('DealStatus','FUNDING_PENDING'),('DealStatus','PICKUP_READINESS'),('DealStatus','HANDOVER_PENDING'),
  ('DealStatus','FROZEN_PENDING_RELEASE'),('FinancingStatus','NOT_STARTED'),('FinancingStatus','IN_PROGRESS'),
  ('FinancingStatus','TERMS_LOCKED'),('FinancingStatus','COMPLETED'),('FinancingStatus','FAILED'),
  ('FinancingStatus','EXPIRED'),('FinancingStatus','NOT_REQUIRED_CASH'),('InsuranceStatus','UNDER_REVIEW'),
  ('InsuranceStatus','REJECTED'),('InsuranceStatus','EXPIRED'),('QueueItemType','PAYMENT_EXCEPTION'),
  ('QueueItemType','SOURCING_EXCEPTION'),('QueueItemType','AUCTION_EXCEPTION'),('QueueItemType','OFFER_EXCEPTION'),
  ('QueueItemType','DEAL_EXCEPTION'),('QueueItemType','FINANCING_EXCEPTION'),('QueueItemType','COMMS_EXCEPTION'),
  ('QueueItemType','INVENTORY_EXCEPTION'),('QueueItemType','DEALER_EXCEPTION'),('QueueItemType','PLAN_EXCEPTION'),
  ('QueueItemType','POST_COMPLETION_EXCEPTION'),('QueueItemType','LINEAGE_ORPHAN'),('PickupStatus','NO_SHOW'),
  ('PickupStatus','RELEASED'),('FinancingAuditEventType','TERMS_LOCKED'),('FinancingAuditEventType','FINANCING_COMPLETED'),
  ('FinancingAuditEventType','FINANCING_FAILED'),('FinancingAuditEventType','FINANCING_EXPIRED'),('FinancingAuditEventType','CASH_CONFIRMED'),
  ('FinancingAuditEventType','EVIDENCE_ATTACHED'),('AdminActionType','LEGACY_PATH_WRITE')
), forbidden_labels(typname, label) AS (VALUES
  -- §13-D11 correction 3 rejected these two; §13-D39 is unruled and withholds the third.
  ('QueueOwnerRole','SUPPORT'),('QueueOwnerRole','CONCIERGE'),('OfferStatus','NOT_SELECTED')
), actual(typname, n) AS (
  SELECT t.typname, count(*)
    FROM pg_type t
    JOIN pg_enum v  ON v.enumtypid = t.oid
    JOIN pg_namespace ns ON ns.oid = t.typnamespace AND ns.nspname = 'public'
   GROUP BY t.typname
)
SELECT 'MISSING' AS status, 'enum_type' AS kind, e.typname AS detail
  FROM expected_types e
 WHERE NOT EXISTS (SELECT 1 FROM actual a WHERE a.typname = e.typname)
UNION ALL SELECT 'MISSING', 'enum_label', l.typname || '.' || l.label
  FROM expected_labels l
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_type t
     JOIN pg_enum v ON v.enumtypid = t.oid
     JOIN pg_namespace ns ON ns.oid = t.typnamespace AND ns.nspname = 'public'
    WHERE t.typname = l.typname AND v.enumlabel = l.label)
-- The silent case: the type exists, so CREATE TYPE was skipped, but it is short of labels.
UNION ALL SELECT 'MISSING', 'enum_cardinality',
       e.typname || ' expected ' || e.n || ', found ' || a.n
  FROM expected_types e JOIN actual a ON a.typname = e.typname
 WHERE a.n <> e.n
UNION ALL SELECT 'MISSING', 'forbidden_label_present', b.typname || '.' || b.label
  FROM forbidden_labels b
 WHERE EXISTS (
   SELECT 1 FROM pg_type t
     JOIN pg_enum v ON v.enumtypid = t.oid
     JOIN pg_namespace ns ON ns.oid = t.typnamespace AND ns.nspname = 'public'
    WHERE t.typname = b.typname AND v.enumlabel = b.label)
-- Positive evidence. COMPUTED, so adding an expectation cannot leave this reporting a stale number.
UNION ALL SELECT 'CHECKED', 'assertions_run',
  ((SELECT count(*) FROM expected_types) * 2
   + (SELECT count(*) FROM expected_labels)
   + (SELECT count(*) FROM forbidden_labels))::text
ORDER BY 1 DESC, 2, 3;
