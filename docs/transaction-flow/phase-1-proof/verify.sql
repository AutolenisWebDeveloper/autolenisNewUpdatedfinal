-- Verifies every object the Phase 1 pair is expected to produce.
--
-- CONTRACT: every returned row carries a `status`. Exactly one row has status 'TOTAL' and reports
-- how many objects were checked; every other row has status 'MISSING' and names one object that
-- should exist and does not (or one that should NOT exist and does). The gate is:
--     PASS  <=>  no row has status = 'MISSING'
-- A silent, zero-row result is NOT a pass — it means the query did not run. Read-only.
WITH expected_enum_labels(typname, label) AS (VALUES
  ('VehicleRequestStatus','DRAFT'),('VehicleRequestStatus','PAYMENT_REQUIRED'),('VehicleRequestStatus','RADIUS_AUTHORIZATION_REQUIRED'),
  ('DealStatus','DEALER_CONFIRMATION'),('DealStatus','RECAP_PENDING'),('DealStatus','DEALER_EXECUTED'),('DealStatus','FUNDING_PENDING'),
  ('DealStatus','PICKUP_READINESS'),('DealStatus','HANDOVER_PENDING'),('DealStatus','FROZEN_PENDING_RELEASE'),
  ('FinancingStatus','NOT_STARTED'),('FinancingStatus','IN_PROGRESS'),('FinancingStatus','TERMS_LOCKED'),('FinancingStatus','COMPLETED'),
  ('FinancingStatus','FAILED'),('FinancingStatus','EXPIRED'),('FinancingStatus','NOT_REQUIRED_CASH'),
  ('InsuranceStatus','UNDER_REVIEW'),('InsuranceStatus','REJECTED'),('InsuranceStatus','EXPIRED'),
  ('QueueItemType','PAYMENT_EXCEPTION'),('QueueItemType','SOURCING_EXCEPTION'),('QueueItemType','AUCTION_EXCEPTION'),
  ('QueueItemType','OFFER_EXCEPTION'),('QueueItemType','DEAL_EXCEPTION'),('QueueItemType','FINANCING_EXCEPTION'),
  ('QueueItemType','COMMS_EXCEPTION'),('QueueItemType','INVENTORY_EXCEPTION'),('QueueItemType','DEALER_EXCEPTION'),
  ('QueueItemType','PLAN_EXCEPTION'),('QueueItemType','POST_COMPLETION_EXCEPTION'),
  ('PickupStatus','NO_SHOW'),('PickupStatus','RELEASED'),
  ('FinancingAuditEventType','TERMS_LOCKED'),('FinancingAuditEventType','FINANCING_COMPLETED'),('FinancingAuditEventType','FINANCING_FAILED'),
  ('FinancingAuditEventType','FINANCING_EXPIRED'),('FinancingAuditEventType','CASH_CONFIRMED'),('FinancingAuditEventType','EVIDENCE_ATTACHED'),
  ('AdminActionType','LEGACY_PATH_WRITE'),
  ('QueueItemType','LINEAGE_ORPHAN'),
  -- §13-D11 correction 3: one member per distinct §26 Owner cell, and no member without a cell.
  ('QueueOwnerRole','OPERATIONS'),('QueueOwnerRole','BUYER'),('QueueOwnerRole','FINANCE'),
  ('QueueOwnerRole','SYSTEM'),('QueueOwnerRole','BUYER_OPERATIONS'),('QueueOwnerRole','COMPLIANCE'),
  ('QueueOwnerRole','OPERATIONS_FINANCE'),('QueueOwnerRole','BUYER_DEALER')
), expected_types(name) AS (VALUES
  ('VehicleRequestEntryType'),('DeliveryPreference'),('AuctionInvitationStatus'),('DealerReaffirmationStatus'),
  ('PostCompletionObligationStatus'),('AuctionVehicleCandidateStatus'),('ESignSignerKind'),('SourcingCandidateSource'),
  ('QueueOwnerRole')
), expected_tables(name) AS (VALUES
  ('co_buyers'),('plan_snapshots'),('sourcing_cases'),('sourcing_candidates'),('dealer_reaffirmations'),('deal_recaps'),
  ('queue_items'),('post_completion_obligations'),('deal_corrections'),('inventory_query_cache'),
  ('comms_outbox'),('lifecycle_touch_schedule'),('idempotency_keys'),('jobs_dead_letter')
), expected_columns(tbl, col) AS (VALUES
  ('vehicle_requests','entry_type'),('vehicle_requests','inventory_item_id'),('vehicle_requests','pre_qualification_id'),
  ('vehicle_requests','current_plan_snapshot_id'),('vehicle_requests','latitude'),('vehicle_requests','authorized_max_radius_miles'),
  ('vehicle_requests','delivery_preference'),('vehicle_requests','exterior_colors'),('vehicle_requests','required_features'),
  ('vehicle_requests','radius_authorization_requested_at'),('vehicle_requests','abandoned_at'),
  ('vehicle_requests','acquisition_channel'),('vehicle_requests','utm_content'),('vehicle_requests','affiliate_id'),
  ('vehicle_requests','consent_version'),('vehicle_requests','stated_budget_cents'),('vehicle_requests','co_buyer_elected'),
  ('deposits','vehicle_request_id'),('deposits','disputed_at'),('deposits','refund_reason'),
  -- PAY-38a's hold triple and PAY-D's disclosure pair.
  ('deposits','hold_reason'),('deposits','hold_released_at'),
  ('deposits','disclosures_accepted_at'),('deposits','disclosures_version'),
  ('vehicle_requests','disclosures_accepted_at'),('vehicle_requests','disclosures_version'),
  ('deals','fee_refund_reason'),('offers','availability_confirmed_at'),
  ('shortlist_items','distance_miles'),('refinance_applications','consent_ip_unavailable_reason'),
  ('deals','vehicle_request_id'),('deals','auction_id'),('deals','deposit_id'),('deals','dealer_id'),('deals','rooftop_id'),
  ('deals','vin'),('deals','odometer_at_offer'),('deals','co_buyer_id'),('deals','otd_cents_confirmed'),
  ('deals','current_plan_snapshot_id'),('deals','recap_confirmed_by_buyer_at'),('deals','vehicle_hold_until'),
  ('deals','financing_terms_locked_at'),('deals','funding_cleared_at'),('deals','dealer_executed_contract_id'),
  ('deals','pickup_ready_at'),('deals','possession_confirmed_at'),('deals','completed_at'),('deals','frozen_at'),
  ('deals','frozen_reason'),('deals','hold_reason'),
  ('offers','auction_vehicle_id'),('offers','vin'),('offers','stock_number'),('offers','availability_confirmed'),
  ('offers','doc_fee_cents'),('offers','add_on_items'),('offers','incentive_items'),('offers','expires_at'),
  ('offers','required_feature_matches'),('offers','photo_urls'),('offers','rooftop_id'),('offers','is_disqualified'),
  ('offers','disqualified_reason'),
  ('auction_invitations','rooftop_id'),('auction_invitations','token_hash'),('auction_invitations','status'),
  ('auction_invitations','candidate_ids'),('auction_invitations','distance_miles'),('auction_invitations','reminder_50_sent_at'),
  ('auction_vehicles','vehicle_request_id'),('auction_vehicles','candidate_status'),('auction_vehicles','listing_snapshot'),
  ('auctions','sourcing_case_id'),
  ('financing','down_payment_cents'),('financing','terms_locked_at'),('financing','failure_reason'),
  ('external_pre_approvals','deal_id'),
  ('insurance_policies','rejection_reason'),('insurance_policies','covers_co_buyer'),('insurance_policies','vin'),
  ('pickups','readiness_confirmed_at'),('pickups','token_hash'),('pickups','dealer_released_at'),
  ('pickups','odometer_at_release'),('pickups','due_bill_items'),('pickups','fulfillment_mode'),
  ('pickups','no_show_at'),('pickups','odometer_at_possession'),('pickups','vin_match'),('pickups','possession_discrepancy'),
  ('trade_in_submissions','vehicle_request_id'),('trade_in_submissions','deal_id'),('trade_in_submissions','payoff_good_through_date'),
  ('trade_in_submissions','preliminary_allowance_cents'),('trade_in_submissions','final_allowance_cents'),
  ('contract_versions','document_hash'),('contract_versions','is_dealer_executed'),('contract_versions','executed_document_hash'),
  ('e_sign_envelopes','signer_kind'),('e_sign_envelopes','co_buyer_id'),
  ('buyers','latitude'),('buyers','geocode_source'),
  ('buyer_opportunities','acquisition_channel'),('buyer_opportunities','affiliate_id'),('buyer_opportunities','consent_version'),
  ('vehicle_requests','ip_unavailable_reason'),('vehicle_requests','consent_ip_unavailable_reason'),
  ('buyer_opportunities','ip_unavailable_reason'),('buyer_opportunities','consent_ip_unavailable_reason'),
  ('dealer_applications','ip_unavailable_reason'),('dealer_applications','consent_ip_unavailable_reason'),
  ('affiliates','ip_unavailable_reason'),('affiliates','consent_ip_unavailable_reason'),
  ('dealer_applications','acquisition_channel'),('dealer_applications','consent_version'),
  ('affiliates','acquisition_channel'),('affiliates','consent_version'),
  ('refinance_applications','interested_in_buying'),('refinance_applications','partner_reference'),
  ('payment_provider_events','processing_at'),('payment_provider_events','disputed_at'),('payment_provider_events','reconciliation_pending_at'),
  ('financing_audit_events','financing_id'),
  ('dealer_scorecard_snapshots','reaffirmation_failure_count'),('dealer_scorecard_snapshots','no_show_count'),
  ('dealer_scorecard_snapshots','contract_delay_count'),('dealer_scorecard_snapshots','overdue_obligation_count'),
  ('circumvention_attempts','dealer_id'),
  ('inventory_items','listing_id'),('inventory_items','provider_last_seen_at'),('inventory_items','mc_website_id'),
  ('dealer_rooftops','mc_rooftop_id'),('dealer_rooftops','operating_status'),('dealer_rooftops','operating_status_checked_at'),
  ('comms_outbox','trigger_event'),('comms_outbox','cancel_key'),('comms_outbox','state_recheck'),('comms_outbox','max_attempts'),
  ('comms_outbox','cancelled_at'),('comms_outbox','cancel_reason'),('comms_outbox','delivered_at')
), expected_indexes(name) AS (VALUES
  ('vehicle_requests_one_open_per_buyer_key'),('offers_one_live_per_rooftop_candidate_key'),
  ('e_sign_envelopes_deal_id_signer_kind_key'),('audit_logs_legacy_path_write_idx'),
  ('co_buyers_vehicle_request_id_key'),('sourcing_cases_vehicle_request_id_key'),
  ('queue_items_idempotency_key_key'),('queue_items_exception_code_idx'),('queue_items_owner_role_status_idx'),
  -- R37a's index list and C2's index half, landed on owner instruction 2026-09-06.
  ('queue_items_status_type_idx'),('queue_items_assigned_admin_id_idx'),('comms_outbox_recipient_idx'),
  ('auction_invitations_token_hash_key'),('auction_invitations_auction_rooftop_key'),
  ('dealer_rooftops_mc_rooftop_id_key'),('inventory_query_cache_criteria_hash_key'),
  ('uq_comms_outbox_dedup_key'),('idx_comms_outbox_drain'),
  ('uq_lifecycle_touch_key_sequence'),('idx_lifecycle_touch_due'),
  ('idx_idempotency_created'),('idx_dlq_event'),('idx_dlq_failed_at'),
  ('deposits_vehicle_request_id_idx'),('deals_current_plan_snapshot_idx'),
  ('vehicle_requests_current_plan_snapshot_idx'),
  ('plan_snapshots_vehicle_request_id_id_key'),('plan_snapshots_deal_id_id_key'),
  ('deals_id_current_plan_snapshot_id_key'),('vehicle_requests_id_current_plan_snapshot_id_key')
), expected_fks(name) AS (VALUES
  ('vehicle_requests_inventory_item_id_fkey'),('vehicle_requests_pre_qualification_id_fkey'),
  ('vehicle_requests_current_plan_snapshot_fkey'),('vehicle_requests_affiliate_id_fkey'),
  ('vehicle_requests_assigned_admin_id_fkey'),
  ('deposits_vehicle_request_id_fkey'),('auctions_sourcing_case_id_fkey'),
  ('co_buyers_buyer_id_fkey'),('co_buyers_vehicle_request_id_fkey'),
  ('plan_snapshots_buyer_id_fkey'),('plan_snapshots_vehicle_request_id_fkey'),('plan_snapshots_deal_id_fkey'),
  ('deals_vehicle_request_id_fkey'),('deals_auction_id_fkey'),('deals_deposit_id_fkey'),('deals_dealer_id_fkey'),
  ('deals_rooftop_id_fkey'),('deals_co_buyer_id_fkey'),('deals_current_plan_snapshot_fkey'),('deals_dealer_executed_contract_id_fkey'),
  ('offers_auction_vehicle_id_fkey'),('offers_rooftop_id_fkey'),('auction_vehicles_vehicle_request_id_fkey'),
  ('auction_invitations_rooftop_id_fkey'),('sourcing_cases_vehicle_request_id_fkey'),
  ('sourcing_candidates_sourcing_case_id_fkey'),('sourcing_candidates_rooftop_id_fkey'),
  ('dealer_reaffirmations_deal_id_fkey'),('dealer_reaffirmations_dealer_id_fkey'),('deal_recaps_deal_id_fkey'),
  ('deal_corrections_deal_id_fkey'),('post_completion_obligations_deal_id_fkey'),
  ('external_pre_approvals_deal_id_fkey'),('financing_audit_events_financing_id_fkey'),('e_sign_envelopes_co_buyer_id_fkey'),
  ('trade_in_submissions_vehicle_request_id_fkey'),('trade_in_submissions_deal_id_fkey'),
  ('queue_items_assigned_admin_id_fkey'),('queue_items_vehicle_request_id_fkey'),('queue_items_deal_id_fkey'),
  ('queue_items_auction_id_fkey'),('queue_items_deposit_id_fkey'),('queue_items_buyer_id_fkey'),('queue_items_dealer_id_fkey'),
  ('circumvention_attempts_dealer_id_fkey'),('buyer_opportunities_affiliate_id_fkey'),('inventory_query_cache_buyer_id_fkey'),
  -- R3, R45/R70/U3, R59/U3 and R43a — the four guarded keys five Phase-1 parity rows assign to this
  -- wave and an earlier draft omitted.
  ('vehicle_requests_buyer_opportunity_id_fkey'),('external_pre_approval_documents_pre_approval_id_fkey'),
  ('deal_status_history_deal_id_fkey'),('shortlist_items_inventory_item_id_fkey')
), expected_checks(name) AS (VALUES
  ('vehicle_requests_ip_unavailable_reason_check'),('vehicle_requests_ip_unavailable_reason_exclusive'),
  ('vehicle_requests_consent_ip_unavailable_reason_check'),('vehicle_requests_consent_ip_unavailable_reason_exclusive'),
  ('buyer_opportunities_ip_unavailable_reason_check'),('buyer_opportunities_ip_unavailable_reason_exclusive'),
  ('buyer_opportunities_consent_ip_unavailable_reason_check'),('buyer_opportunities_consent_ip_unavailable_reason_exclusive'),
  ('dealer_applications_ip_unavailable_reason_check'),('dealer_applications_ip_unavailable_reason_exclusive'),
  ('dealer_applications_consent_ip_unavailable_reason_check'),('dealer_applications_consent_ip_unavailable_reason_exclusive'),
  ('affiliates_ip_unavailable_reason_check'),('affiliates_ip_unavailable_reason_exclusive'),
  ('affiliates_consent_ip_unavailable_reason_check'),('affiliates_consent_ip_unavailable_reason_exclusive'),
  -- §7 applies to every captured address; `refinance_applications.consent_ip` is one.
  ('refinance_applications_consent_ip_unavailable_reason_check'),
  ('refinance_applications_consent_ip_unavailable_reason_exclusive'),
  -- R30 (WF:1574).
  ('deals_offer_lineage_check')
), expected_triggers(name) AS (VALUES
  ('shortlist_items_enforce_cap_trg'),('auction_vehicles_enforce_cap_trg'),('plan_snapshots_append_only_trg')
), expected_rls(name) AS (VALUES
  ('co_buyers'),('plan_snapshots'),('sourcing_cases'),('sourcing_candidates'),('dealer_reaffirmations'),('deal_recaps'),
  ('queue_items'),('post_completion_obligations'),('deal_corrections'),('inventory_query_cache'),
  ('comms_outbox'),('lifecycle_touch_schedule'),('idempotency_keys'),('jobs_dead_letter')

-- Every value a rewritten CHECK must still admit afterwards (§13-D24 gaps (a) and (b); R88's
-- acceptance evidence — "verify.sql asserts the constraint definition"). This list is production's
-- CURRENT value set plus the wave's additions, so a future edit that drops one of production's
-- values fails here rather than in production with a 23514. `run-proof.sh` additionally re-derives
-- the "before" side from the committed baseline on every run, so a narrowing cannot pass by being
-- deleted from this list too.
), expected_check_values(conname, value) AS (VALUES
  -- comms_outbox.channel — production {email, sms}; M27-04a adds in_app.
  ('comms_outbox_channel_check','email'),('comms_outbox_channel_check','sms'),
  ('comms_outbox_channel_check','in_app'),
  -- comms_outbox.status — production's six; R88/C9/C11 add delivered and cancelled.
  ('comms_outbox_status_check','pending'),('comms_outbox_status_check','sending'),
  ('comms_outbox_status_check','sent'),('comms_outbox_status_check','failed'),
  ('comms_outbox_status_check','suppressed'),('comms_outbox_status_check','skipped'),
  ('comms_outbox_status_check','delivered'),('comms_outbox_status_check','cancelled'),
  -- lifecycle_touch_schedule.sequence — production's 19, unchanged. deposit_reminder_5 and _6 are
  -- the six-touch $99 recovery cadence (PAY-19, B1); losing either is a 23514 at touch five.
  ('lifecycle_touch_sequence_allowed','deposit_reminder_1'),('lifecycle_touch_sequence_allowed','deposit_reminder_2'),
  ('lifecycle_touch_sequence_allowed','deposit_reminder_3'),('lifecycle_touch_sequence_allowed','deposit_reminder_4'),
  ('lifecycle_touch_sequence_allowed','deposit_reminder_5'),('lifecycle_touch_sequence_allowed','deposit_reminder_6'),
  ('lifecycle_touch_sequence_allowed','auction_active'),('lifecycle_touch_sequence_allowed','auction_midpoint'),
  ('lifecycle_touch_sequence_allowed','auction_closing'),('lifecycle_touch_sequence_allowed','dealer_invited'),
  ('lifecycle_touch_sequence_allowed','offer_received'),('lifecycle_touch_sequence_allowed','offer_follow_up_1'),
  ('lifecycle_touch_sequence_allowed','offer_follow_up_2'),('lifecycle_touch_sequence_allowed','deal_complete'),
  ('lifecycle_touch_sequence_allowed','review_request'),('lifecycle_touch_sequence_allowed','form_submitted'),
  ('lifecycle_touch_sequence_allowed','check_form_completion_1'),('lifecycle_touch_sequence_allowed','check_form_completion_2'),
  ('lifecycle_touch_sequence_allowed','check_form_completion_3'),
  -- The two CHECKs the wave adopts without rewriting, asserted so an edit cannot quietly restate
  -- them narrower inside the guarded CREATE TABLE.
  ('lifecycle_touch_schedule_status_check','pending'),('lifecycle_touch_schedule_status_check','sending'),
  ('lifecycle_touch_schedule_status_check','done'),('lifecycle_touch_schedule_status_check','canceled'),
  ('lifecycle_touch_schedule_status_check','failed'),
  ('idempotency_keys_execution_status_check','processing'),('idempotency_keys_execution_status_check','completed'),
  ('idempotency_keys_execution_status_check','failed')

-- §13-D11 correction 1. Constraint existence is not enough: a key onto `users(id)` carries the same
-- name and would pass the FK check above while rejecting every real assignment at runtime, because
-- the admin actor id is `Admin.id` and `Admin.id` <> `Admin.userId`.
), expected_fk_targets(conname, parent) AS (VALUES
  ('queue_items_assigned_admin_id_fkey','admins'),
  ('vehicle_requests_assigned_admin_id_fkey','admins')

-- §13-D11 correction 3. Both had zero §26 Owner cells; neither may come back.
), forbidden_enum_labels(typname, label) AS (VALUES
  ('QueueOwnerRole','SUPPORT'),('QueueOwnerRole','CONCIERGE'),
  -- §13-D39 is unruled and an enum label cannot be dropped once shipped, so the wave withholds
  -- `OfferStatus.NOT_SELECTED` rather than foreclosing the decision. Asserting it ABSENT is what
  -- keeps the omission a decision: a later edit that quietly re-adds it fails the proof here.
  ('OfferStatus','NOT_SELECTED')

-- §13-D11 correction 2. Asserting that the TYPE exists is not the same as asserting the COLUMN uses
-- it: a DDL edit that declared `QueueOwnerRole` and left `owner_role` as TEXT would satisfy every
-- other assertion here.
), expected_column_types(tbl, col, udt) AS (VALUES
  ('queue_items','owner_role','QueueOwnerRole')

-- R36 states the QueueItemType cardinality as a TEST, and README cites it as evidence; naming the
-- twelve new labels does not assert it. A thirteenth label added by a later edit would satisfy every
-- label check above and silently break the one-type-per-§26-row tabulation the exception register is
-- derived from. Same for QueueOwnerRole's one-member-per-Owner-cell rule.
), expected_enum_cardinality(typname, n) AS (VALUES
  ('QueueItemType', 20), ('QueueOwnerRole', 8)

-- The referential ACTIONS, not just the keys. `confdeltype`/`confupdtype` are single chars:
-- a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL. An existence-only FK census cannot tell
-- `ON DELETE SET NULL` from `ON DELETE CASCADE`, and on the two composite plan-snapshot keys the
-- difference between a bare SET NULL and a column-list SET NULL is the difference between a
-- deletable row and a 23502 on the parent's primary key.
), expected_fk_actions(conname, del, upd) AS (VALUES
  ('vehicle_requests_current_plan_snapshot_fkey','n','a'),
  ('deals_current_plan_snapshot_fkey','n','a'),
  -- These three are created by the section 6 helper, which uses ON UPDATE CASCADE uniformly for
  -- every key it writes (migration.sql:1035). The assertion records the convention rather than
  -- silently diverging from it; only the two composite keys above are written by hand, and they are
  -- the two that must NOT cascade, because their referencing column list includes a primary key.
  ('shortlist_items_inventory_item_id_fkey','r','c'),
  ('deal_status_history_deal_id_fkey','r','c'),
  ('external_pre_approval_documents_pre_approval_id_fkey','c','c')

-- And the SET NULL column list itself: exactly one column, and it must be the pointer, never the
-- primary key. `confdelsetcols` is NULL for a bare SET NULL, which is precisely the defect.
), expected_fk_setcols(conname, col) AS (VALUES
  ('vehicle_requests_current_plan_snapshot_fkey','current_plan_snapshot_id'),
  ('deals_current_plan_snapshot_fkey','current_plan_snapshot_id')
)
SELECT 'MISSING' AS status, 'enum_label' AS kind, typname || '.' || label AS object FROM expected_enum_labels e
  WHERE NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum v ON v.enumtypid=t.oid
                    WHERE t.typname=e.typname AND v.enumlabel=e.label)
UNION ALL SELECT 'MISSING', 'enum_type', name FROM expected_types WHERE to_regtype(quote_ident(name)) IS NULL
UNION ALL SELECT 'MISSING', 'table', name FROM expected_tables WHERE to_regclass('public.'||quote_ident(name)) IS NULL
UNION ALL SELECT 'MISSING', 'column', tbl || '.' || col FROM expected_columns c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=c.tbl AND column_name=c.col)
UNION ALL SELECT 'MISSING', 'index', name FROM expected_indexes i
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=i.name)
UNION ALL SELECT 'MISSING', 'foreign_key', name FROM expected_fks f
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=f.name AND contype='f')
UNION ALL SELECT 'MISSING', 'check_constraint', name FROM expected_checks k
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=k.name AND contype='c')
UNION ALL SELECT 'MISSING', 'trigger', name FROM expected_triggers g
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=g.name AND NOT tgisinternal)
UNION ALL SELECT 'MISSING', 'rls_enabled', name FROM expected_rls r
  WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname=r.name AND c.relrowsecurity)
UNION ALL SELECT 'MISSING', 'rls_policy_present_unexpectedly', r.name FROM expected_rls r
  WHERE EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=r.name)
-- Phase 1 is additive: the LIVE unique on deal_id must still be here afterwards. Its removal is the
-- signatures-phase cutover, not this wave. Flag it if this wave dropped it.
UNION ALL SELECT 'MISSING', 'live_constraint_wrongly_dropped', 'e_sign_envelopes_deal_id_key'
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='e_sign_envelopes_deal_id_key')
-- A CHECK must still admit every value production admitted, plus the wave's additions. The literal
-- is matched QUOTED on both sides, and that is what makes it exact: `'deposit_reminder_1'` cannot be
-- satisfied by `'deposit_reminder_10'`, nor `'sent'` by `'suppressed'`, because the closing quote
-- has to match too. `strpos`, not `LIKE`, because LIKE would read `%` and `_` in the value as
-- wildcards — 24 of the values below contain `_` — and a renamed label could then satisfy an
-- assertion it should fail. `strpos` has no pattern metacharacters at all.
UNION ALL SELECT 'MISSING', 'check_admitted_value', v.conname || ' admits ' || v.value
  FROM expected_check_values v
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND c.contype = 'c' AND c.conname = v.conname
       AND strpos(pg_get_constraintdef(c.oid), quote_literal(v.value)) > 0)
-- A foreign key must point at the table it is supposed to point at, not merely exist.
UNION ALL SELECT 'MISSING', 'foreign_key_target', f.conname || ' -> ' || f.parent
  FROM expected_fk_targets f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class p ON p.oid = c.confrelid
     WHERE c.conname = f.conname AND c.contype = 'f' AND p.relname = f.parent)
-- A column must have the type the correction gave it, not merely exist.
UNION ALL SELECT 'MISSING', 'column_type', c.tbl || '.' || c.col || ' :: ' || c.udt
  FROM expected_column_types c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col
       AND udt_name = c.udt)
-- A label that must NOT exist. Enum labels cannot be dropped once shipped, so this fails while it
-- is still cheap to fail.
UNION ALL SELECT 'MISSING', 'forbidden_enum_label_present', e.typname || '.' || e.label
  FROM forbidden_enum_labels e
  WHERE EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum v ON v.enumtypid = t.oid
     WHERE t.typname = e.typname AND v.enumlabel = e.label)
UNION ALL SELECT 'MISSING', 'enum_cardinality',
       c.typname || ' expected ' || c.n || ' labels, found ' ||
       (SELECT count(*) FROM pg_enum v JOIN pg_type t ON t.oid = v.enumtypid WHERE t.typname = c.typname)
  FROM expected_enum_cardinality c
  WHERE (SELECT count(*) FROM pg_enum v JOIN pg_type t ON t.oid = v.enumtypid
          WHERE t.typname = c.typname) <> c.n
UNION ALL SELECT 'MISSING', 'fk_action', a.conname || ' del/upd'
  FROM expected_fk_actions a
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k
                     WHERE k.conname = a.conname AND k.contype = 'f'
                       AND k.confdeltype = a.del AND k.confupdtype = a.upd)
UNION ALL SELECT 'MISSING', 'fk_set_null_column', c.conname || '.' || c.col
  FROM expected_fk_setcols c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint k
     WHERE k.conname = c.conname AND k.contype = 'f'
       AND k.confdelsetcols IS NOT NULL
       AND array_length(k.confdelsetcols, 1) = 1
       AND (SELECT attname FROM pg_attribute
             WHERE attrelid = k.conrelid AND attnum = k.confdelsetcols[1]) = c.col)
-- Positive evidence: what this run actually checked. Always exactly one row.
UNION ALL SELECT 'TOTAL', 'expected_objects_checked',
  ((SELECT count(*) FROM expected_enum_labels) + (SELECT count(*) FROM expected_types)
   + (SELECT count(*) FROM expected_tables) + (SELECT count(*) FROM expected_columns)
   + (SELECT count(*) FROM expected_indexes) + (SELECT count(*) FROM expected_fks)
   + (SELECT count(*) FROM expected_checks) + (SELECT count(*) FROM expected_triggers)
   + (SELECT count(*) FROM expected_rls) * 2
   + (SELECT count(*) FROM expected_check_values) + (SELECT count(*) FROM expected_fk_targets)
   + (SELECT count(*) FROM forbidden_enum_labels) + (SELECT count(*) FROM expected_column_types)
   + (SELECT count(*) FROM expected_enum_cardinality) + (SELECT count(*) FROM expected_fk_actions)
   + (SELECT count(*) FROM expected_fk_setcols)
   + 1)::text
ORDER BY 1 DESC, 2, 3;
