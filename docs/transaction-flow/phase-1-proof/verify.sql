-- Verifies every object the Phase 1 pair is expected to produce. Reports one row per missing object;
-- zero rows means every expected object exists. Read-only.
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
  ('OfferStatus','NOT_SELECTED')
), expected_types(name) AS (VALUES
  ('VehicleRequestEntryType'),('DeliveryPreference'),('AuctionInvitationStatus'),('DealerReaffirmationStatus'),
  ('PostCompletionObligationStatus'),('AuctionVehicleCandidateStatus'),('ESignSignerKind'),('SourcingCandidateSource')
), expected_tables(name) AS (VALUES
  ('co_buyers'),('plan_snapshots'),('sourcing_cases'),('sourcing_candidates'),('dealer_reaffirmations'),('deal_recaps'),
  ('queue_items'),('post_completion_obligations'),('deal_corrections'),('inventory_query_cache'),
  ('comms_outbox'),('lifecycle_touch_schedule'),('idempotency_keys'),('jobs_dead_letter')
), expected_columns(tbl, col) AS (VALUES
  ('vehicle_requests','entry_type'),('vehicle_requests','inventory_item_id'),('vehicle_requests','pre_qualification_id'),
  ('vehicle_requests','plan_snapshot_id'),('vehicle_requests','latitude'),('vehicle_requests','authorized_max_radius_miles'),
  ('vehicle_requests','delivery_preference'),('vehicle_requests','exterior_colors'),('vehicle_requests','required_features'),
  ('vehicle_requests','radius_authorization_requested_at'),('vehicle_requests','abandoned_at'),
  ('vehicle_requests','acquisition_channel'),('vehicle_requests','utm_content'),('vehicle_requests','affiliate_id'),
  ('vehicle_requests','consent_version'),('vehicle_requests','stated_budget_cents'),('vehicle_requests','co_buyer_elected'),
  ('deposits','vehicle_request_id'),('deposits','disputed_at'),('deposits','refund_reason'),
  ('deals','vehicle_request_id'),('deals','auction_id'),('deals','deposit_id'),('deals','dealer_id'),('deals','rooftop_id'),
  ('deals','vin'),('deals','odometer_at_offer'),('deals','co_buyer_id'),('deals','otd_cents_confirmed'),
  ('deals','plan_snapshot_id'),('deals','recap_confirmed_by_buyer_at'),('deals','vehicle_hold_until'),
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
  ('comms_outbox','trigger_event'),('comms_outbox','cancel_key'),('comms_outbox','state_recheck'),('comms_outbox','max_attempts')
), expected_indexes(name) AS (VALUES
  ('vehicle_requests_one_open_per_buyer_key'),('offers_one_live_per_rooftop_candidate_key'),
  ('e_sign_envelopes_deal_id_signer_kind_key'),('audit_logs_legacy_path_write_idx'),
  ('co_buyers_vehicle_request_id_key'),('sourcing_cases_vehicle_request_id_key'),
  ('queue_items_idempotency_key_key'),('queue_items_exception_code_idx'),
  ('auction_invitations_token_hash_key'),('auction_invitations_auction_rooftop_key'),
  ('dealer_rooftops_mc_rooftop_id_key'),('inventory_query_cache_criteria_hash_key'),
  ('uq_comms_outbox_dedup_key'),('idx_comms_outbox_drain'),
  ('uq_lifecycle_touch_key_sequence'),('idx_lifecycle_touch_due'),
  ('idx_idempotency_created'),('idx_dlq_event'),('idx_dlq_failed_at'),
  ('deposits_vehicle_request_id_idx'),('deals_plan_snapshot_id_idx')
), expected_fks(name) AS (VALUES
  ('vehicle_requests_inventory_item_id_fkey'),('vehicle_requests_pre_qualification_id_fkey'),
  ('vehicle_requests_plan_snapshot_id_fkey'),('vehicle_requests_affiliate_id_fkey'),
  ('vehicle_requests_assigned_admin_id_fkey'),
  ('deposits_vehicle_request_id_fkey'),('auctions_sourcing_case_id_fkey'),
  ('co_buyers_buyer_id_fkey'),('co_buyers_vehicle_request_id_fkey'),
  ('plan_snapshots_buyer_id_fkey'),('plan_snapshots_vehicle_request_id_fkey'),('plan_snapshots_deal_id_fkey'),
  ('deals_vehicle_request_id_fkey'),('deals_auction_id_fkey'),('deals_deposit_id_fkey'),('deals_dealer_id_fkey'),
  ('deals_rooftop_id_fkey'),('deals_co_buyer_id_fkey'),('deals_plan_snapshot_id_fkey'),('deals_dealer_executed_contract_id_fkey'),
  ('offers_auction_vehicle_id_fkey'),('offers_rooftop_id_fkey'),('auction_vehicles_vehicle_request_id_fkey'),
  ('auction_invitations_rooftop_id_fkey'),('sourcing_cases_vehicle_request_id_fkey'),
  ('sourcing_candidates_sourcing_case_id_fkey'),('sourcing_candidates_rooftop_id_fkey'),
  ('dealer_reaffirmations_deal_id_fkey'),('dealer_reaffirmations_dealer_id_fkey'),('deal_recaps_deal_id_fkey'),
  ('deal_corrections_deal_id_fkey'),('post_completion_obligations_deal_id_fkey'),
  ('external_pre_approvals_deal_id_fkey'),('financing_audit_events_financing_id_fkey'),('e_sign_envelopes_co_buyer_id_fkey'),
  ('trade_in_submissions_vehicle_request_id_fkey'),('trade_in_submissions_deal_id_fkey'),
  ('queue_items_assigned_admin_id_fkey'),('queue_items_vehicle_request_id_fkey'),('queue_items_deal_id_fkey'),
  ('queue_items_auction_id_fkey'),('queue_items_deposit_id_fkey'),('queue_items_buyer_id_fkey'),('queue_items_dealer_id_fkey'),
  ('circumvention_attempts_dealer_id_fkey'),('buyer_opportunities_affiliate_id_fkey'),('inventory_query_cache_buyer_id_fkey')
), expected_triggers(name) AS (VALUES
  ('shortlist_items_enforce_cap_trg'),('auction_vehicles_enforce_cap_trg')
), expected_rls(name) AS (VALUES
  ('co_buyers'),('plan_snapshots'),('sourcing_cases'),('sourcing_candidates'),('dealer_reaffirmations'),('deal_recaps'),
  ('queue_items'),('post_completion_obligations'),('deal_corrections'),('inventory_query_cache'),
  ('comms_outbox'),('lifecycle_touch_schedule'),('idempotency_keys'),('jobs_dead_letter')
)
SELECT 'enum_label' AS kind, typname || '.' || label AS object FROM expected_enum_labels e
  WHERE NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum v ON v.enumtypid=t.oid
                    WHERE t.typname=e.typname AND v.enumlabel=e.label)
UNION ALL SELECT 'enum_type', name FROM expected_types WHERE to_regtype(quote_ident(name)) IS NULL
UNION ALL SELECT 'table', name FROM expected_tables WHERE to_regclass('public.'||quote_ident(name)) IS NULL
UNION ALL SELECT 'column', tbl || '.' || col FROM expected_columns c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=c.tbl AND column_name=c.col)
UNION ALL SELECT 'index', name FROM expected_indexes i
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=i.name)
UNION ALL SELECT 'foreign_key', name FROM expected_fks f
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=f.name AND contype='f')
UNION ALL SELECT 'trigger', name FROM expected_triggers g
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=g.name AND NOT tgisinternal)
UNION ALL SELECT 'rls_enabled', name FROM expected_rls r
  WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname=r.name AND c.relrowsecurity)
UNION ALL SELECT 'rls_policy_present_unexpectedly', r.name FROM expected_rls r
  WHERE EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=r.name)
UNION ALL SELECT 'stale_unique_should_be_gone', 'e_sign_envelopes_deal_id_key'
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='e_sign_envelopes_deal_id_key')
ORDER BY 1,2;
