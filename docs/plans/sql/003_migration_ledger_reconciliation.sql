-- 003_migration_ledger_reconciliation.sql
--
-- The runnable form of docs/plans/MIGRATION-LEDGER-RECONCILIATION.md §7.7.
-- That section shipped with `<sha256-of-file>` placeholders; this file carries the
-- real values, computed from the migration files at main c70af6b.
--
-- WHAT IT DOES, in one transaction:
--   (a) realigns 6 stale ledger checksums to their current repo files  (§7.3)
--   (b) records the 29 migrations whose objects are verified present   (§5.1)
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * It does not touch 20261014000000_esign_envelope_history,
--     20261015000000_esign_consent_and_executed_artifact, or
--     20261016000000_ai_action_intent_lifecycle. Those stay unrecorded by owner
--     decision (§5.2) and the block ABORTS if it finds any of them already
--     recorded. ESIGN_EXECUTED_ARTIFACT_ENABLED remains the enforcement
--     mechanism — the ledger cannot hold that line (§5.3.2).
--   * It runs no DDL and no migration SQL. `resolve --applied` semantics only.
--
-- WHO RUNS IT: a human with a real production DATABASE_URL. No agent session has
-- one, and the Supabase MCP is read-only for production
-- (.claude/MCP_INVENTORY.md:27).
--
-- PROVENANCE: every checksum below is sha256(migration.sql). That algorithm was
-- proven against the live ledger — it reproduces the stored value for 61 of the 67
-- recorded rows; the 6 exceptions are exactly the rows section (a) repairs.
-- Object presence for all 29 was re-verified read-only against
-- aieybibvewmvrubcpthm: 28 of 28 direct probes PRESENT, plus
-- 20261018000000 confirmed a no-op (its guard needs session_id present and
-- contact_id absent; production has the inverse, the live CRM inbox shape).
--
-- PRE-FLIGHT: the block asserts the ledger is at exactly 67 rows before it starts.
-- Verified at 2026-08-31T18:5xZ: 67 rows, 0 unfinished, 0 rolled back, 0 gated
-- recorded. If the count has moved since, STOP and re-read §7 before forcing it.

-- ---------------------------------------------------------------------------
-- STEP 1 — snapshot. This is the whole undo. Do not skip it. (§5.3.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _prisma_migrations_backup_20260831 AS
  SELECT * FROM _prisma_migrations;

-- Confirm the snapshot took before going further.
SELECT count(*) AS snapshot_rows FROM _prisma_migrations_backup_20260831;
-- expect: 67

-- ---------------------------------------------------------------------------
-- STEP 2 — the reconciliation. One statement, all-or-nothing.
-- Any guard that trips raises and rolls the whole block back.
-- ---------------------------------------------------------------------------
DO $reconcile$
DECLARE
  before_ct  int;
  after_ct   int;
  upd_ct     int;
  ins_ct     int;
BEGIN
  SELECT count(*) INTO before_ct FROM _prisma_migrations;
  IF before_ct <> 67 THEN
    RAISE EXCEPTION 'ledger not at the verified baseline of 67 rows, found % — stop and re-read section 7', before_ct;
  END IF;

  IF EXISTS (
    SELECT 1 FROM _prisma_migrations WHERE migration_name IN (
      '20261014000000_esign_envelope_history',
      '20261015000000_esign_consent_and_executed_artifact',
      '20261016000000_ai_action_intent_lifecycle')
  ) THEN
    RAISE EXCEPTION 'an owner-gated migration is already recorded — stop and investigate before reconciling';
  END IF;

  -- (a) Realign the six stale checksums to the current repo files.
  --     Each was edited AFTER being recorded, by f2032cf (five) and 599b5a8 (one),
  --     both 2026-08-29. The files are correct — they are what makes the chain
  --     build from zero, which CI gates — so the LEDGER moves, not the files.
  UPDATE _prisma_migrations m
     SET checksum = v.sum
    FROM (VALUES
      ('20260507000000_add_prequal_consent_accepted_at',  'd842256d5e577bd1096c166fc9168d068a3ddb4e82fcf63ddc8d967f0025a004'),
      ('20260702000000_add_admin_mfa_rate_limit',         '636dcba9d1672c6176dbe1586de8c13949fad3aa4ef5e0de12b4acfebfb93f34'),
      ('20260703000000_add_admin_pending_recovery_codes', 'f6d278bae9d44e80599fc7ea2432cabfbc32a7d94362caebdb6e790b280bb2c4'),
      ('20260703000000_add_pending_recovery_codes',       '3185ff8775c1b82fc54d5d62717d80b2bf741ab30650c1f0e7ef9b890918d18e'),
      ('20260801000005_affiliate_onboarding',             'fc6927793889d755f1f6d74d89328ca3b6274656c7580b5e1a8f4ee1898a9c4a'),
      ('20260911000000_add_acquisition_system',           '4b522ab8d95f1d2a3965abc302a2b14b1d6fffc320c88ae91454b13f396e23db')
    ) AS v(name, sum)
   WHERE m.migration_name = v.name;

  GET DIAGNOSTICS upd_ct = ROW_COUNT;
  IF upd_ct <> 6 THEN
    RAISE EXCEPTION 'realigned % checksums, expected 6', upd_ct;
  END IF;

  -- (b) Record the 29 migrations whose objects are verified physically present.
  --     applied_steps_count = 0 is what `prisma migrate resolve --applied` writes,
  --     and it is the honest value: these rows attest presence, they do not claim
  --     a step was executed. (Contrast the 12 hand-written 2026-06-20 rows, which
  --     claim 1. This file does not repeat that.)
  INSERT INTO _prisma_migrations
    (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES
    (gen_random_uuid(), '4fbb78bb897128295a6f92eeb47360f1144a108768bce8d35cf3ee7b7d2df163', now(), '20260828000000_dealer_invitation_token_hash',                 'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '76f264acb9723864844e1696358357319da88a7bf00b66f2f7361f78352e7743', now(), '20260919000005_add_esign_envelope_document_key',              'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'c3f1b96d7d0cc4c16273a509f2234032069c2fc81856c19de0f720ccfca992e5', now(), '20260919000006_add_referral_milestone_config',               'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '047e2153c0a387f6066cb5fb80bec5760c5b1d28ac50f0d2ac2a1f9531bde161', now(), '20260920000000_add_buyer_opportunity_intake_processed_at',   'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '9730ed81d064069a906a60daacfe4805b531dbd4ea3098d15d087a10dbe3e943', now(), '20260921000000_add_funnel_stage_snapshot',                   'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'b154411cb312d926d4bea25c395bb01dcaea7af7090d4871a7bca862c46e9d36', now(), '20260922000000_add_dealer_prospect_email_verification',      'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'dfe98d2d71e3445c915fbb8bdd8b791893349f3f954835a9a941c34d0cc94384', now(), '20260923000000_add_dealer_and_prospect_coordinates',         'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '5cf0ddf725c76320835746ccbabca837f8ecb15729d63542ef6bbfe796962f4d', now(), '20260924000000_add_dealer_rooftop',                          'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'dcf85f1048103ec07d226b04102836d91530d6bd395dce639a630755b129afd1', now(), '20260925000000_add_dealer_contact_profile',                  'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '055a8f591a04bc5660bd1945a4d4e33b6bafe50fb95bc41fd3718e343dae2998', now(), '20260926000000_add_apollo_credit_ledger',                    'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '1a893101cb2343b28501841baeaad4d8a442b8705c67d2143e74234eb1635848', now(), '20260927000000_add_auction_anti_snipe',                      'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'a5f11f08856c5c4cc657609f2604babe49d0da5c416e9aa3d4525583ff896844', now(), '20260928000000_add_outside_invite_rooftop_expiry',           'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '5f87be8740584d3c77e12f19a1393def9d0d652e7b2e611fa434744ae3915f77', now(), '20260929000000_add_vehicle_request_coverage_hold',           'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '784fea4c00f5e4514065b7ad48a06995c0aaf72569c6cafbc2832fccf8f20230', now(), '20260930000000_add_dealer_availability',                     'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'f63a7c71a101064b77c795daaaca70cd1088ea148b7f82fb0a96f4f8f85243dd', now(), '20261001000000_pickup_confirm_roundtrip',                    'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '50e20649a76c1dc05cb2bf242329f4c1b168d645842e32800912721912f58551', now(), '20261002000000_cron_job_logs_index',                         'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'ad8d88e0d4fd10f3e1942341fbbcf74097e877fbf8a61e13203eaf7e5dbd0a4f', now(), '20261003000000_auction_vehicle_request_fk',                  'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '8c843df46b3adad967c5d23a02e6d6c4baa0368f3112ed8ad559b88eec65989c', now(), '20261004000000_phase5_block1_rules_audit',                   'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), '8cf5188a91d1a87aee7505652c8280d7be316a726cdb32c94c92675455dd9098', now(), '20261005000000_phase5_block3_credit_application',            'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'cd3fef82210a1fcb99819db168bfec9d68186236b07d73ba2d36f13064c895ed', now(), '20261006000000_phase5_block4_review_queue',                  'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'bb7efbbbf52b54b8d549f76b5e2dbd4c363e2f877796eeba7002390aeb6531ab', now(), '20261007000000_phase5_credit_app_one_active_per_deal',       'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'e50f200a87fb69019082328b32a70caa972405c9fa2b81b1cd12f587f2bb5593', now(), '20261008000000_add_buyer_opportunity_intake_retry_terminal', 'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'd4e7bcb4640586a395e72247acf4b82e54484eece28248f0cb5a733d98301461', now(), '20261009000000_add_deal_dealer_award_dispatch',              'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'e65fe03da8d59d6a4d43c187c2473383a5c75720c435b4b8cc29ffb67c6f177c', now(), '20261010000000_batch1_inventory_matching_truthfulness',      'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'c19f16f6310f4514cc8c6ba150a5a95fa8299db2795f45fc8602898a0068f180', now(), '20261012000000_add_buyer_request_claim_token',               'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'e7d83fce37fce6edfc37b9809c59f0c4bb7148400e43945c3d4085f2c97db8fb', now(), '20261013000000_esign_inhouse_evidence',                      'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; NOT owner-gated (the esign-schema-gate names only 20261014/20261015).', NULL, now(), 0),
    (gen_random_uuid(), '43f0eb7426508ec59899dd2b9815de0d843f7199d30c7893370c268b209ce6ae', now(), '20261017000000_migration_chain_functional_reconciliation',   'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: objects verified physically present; equivalent to prisma migrate resolve --applied.', NULL, now(), 0),
    (gen_random_uuid(), 'baf85001c0e979984a1fd0e0c8a70adae1af64f000a3d242d187c52be309c9b8', now(), '20261018000000_retire_misnamed_conversations_table',         'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: verified NO-OP in production — its guard requires session_id present and contact_id absent; production conversations has the inverse (live CRM inbox). Applied and run-to-completion are the same state here.', NULL, now(), 0),
    (gen_random_uuid(), 'd1c7bcced5ca213ac36ddbc9ddf1c1e979ccb345c2eef1383dc01db0e54597b1', now(), '20261102000000_dealer_outreach_apollo_operational',          'Reconciled per MIGRATION-LEDGER-RECONCILIATION.md 5.1: both tables, all 17 columns and all probed indexes verified present; fully idempotent.', NULL, now(), 0);

  GET DIAGNOSTICS ins_ct = ROW_COUNT;
  IF ins_ct <> 29 THEN
    RAISE EXCEPTION 'recorded % rows, expected 29', ins_ct;
  END IF;

  SELECT count(*) INTO after_ct FROM _prisma_migrations;
  IF after_ct <> 96 THEN
    RAISE EXCEPTION 'post-write count is %, expected 96', after_ct;
  END IF;

  RAISE NOTICE 'ledger reconciled: % -> % rows (% checksums realigned, % migrations recorded)',
    before_ct, after_ct, upd_ct, ins_ct;
END
$reconcile$;

-- ---------------------------------------------------------------------------
-- STEP 3 — verify. All four rows should read OK.
-- ---------------------------------------------------------------------------
SELECT 'row count'          AS check,
       count(*)::text       AS actual, '96' AS expected,
       CASE WHEN count(*) = 96 THEN 'OK' ELSE 'FAIL' END AS result
  FROM _prisma_migrations
UNION ALL
SELECT 'unfinished', count(*) FILTER (WHERE finished_at IS NULL)::text, '0',
       CASE WHEN count(*) FILTER (WHERE finished_at IS NULL) = 0 THEN 'OK' ELSE 'FAIL' END
  FROM _prisma_migrations
UNION ALL
SELECT 'rolled back', count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text, '0',
       CASE WHEN count(*) FILTER (WHERE rolled_back_at IS NOT NULL) = 0 THEN 'OK' ELSE 'FAIL' END
  FROM _prisma_migrations
UNION ALL
SELECT 'owner-gated still unrecorded',
       count(*)::text, '0',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END
  FROM _prisma_migrations
 WHERE migration_name IN ('20261014000000_esign_envelope_history',
                          '20261015000000_esign_consent_and_executed_artifact',
                          '20261016000000_ai_action_intent_lifecycle');

-- Then, from frontend/ with the production URL exported as $DB:
--   DATABASE_URL="$DB" DIRECT_URL="$DB" pnpm exec prisma migrate status
--
-- Expect: no "modified after applied" report, and exactly three pending —
-- 20261014000000, 20261015000000, 20261016000000.
--
-- ⚠️  §5.3.2 STILL APPLIES, AND MATTERS MORE ONCE STATUS IS CLEAN: the next
--     `prisma migrate deploy` targets exactly those three. All are effectively
--     idempotent, so it would succeed as a near-no-op and record them —
--     flipping the compliance boundary in the ledger silently. Do not run
--     `migrate deploy` against production without deciding that first.

-- ---------------------------------------------------------------------------
-- UNDO — only if something above read FAIL.
-- ---------------------------------------------------------------------------
-- BEGIN;
--   DELETE FROM _prisma_migrations
--    WHERE migration_name IN (
--      '20260828000000_dealer_invitation_token_hash','20260919000005_add_esign_envelope_document_key',
--      '20260919000006_add_referral_milestone_config','20260920000000_add_buyer_opportunity_intake_processed_at',
--      '20260921000000_add_funnel_stage_snapshot','20260922000000_add_dealer_prospect_email_verification',
--      '20260923000000_add_dealer_and_prospect_coordinates','20260924000000_add_dealer_rooftop',
--      '20260925000000_add_dealer_contact_profile','20260926000000_add_apollo_credit_ledger',
--      '20260927000000_add_auction_anti_snipe','20260928000000_add_outside_invite_rooftop_expiry',
--      '20260929000000_add_vehicle_request_coverage_hold','20260930000000_add_dealer_availability',
--      '20261001000000_pickup_confirm_roundtrip','20261002000000_cron_job_logs_index',
--      '20261003000000_auction_vehicle_request_fk','20261004000000_phase5_block1_rules_audit',
--      '20261005000000_phase5_block3_credit_application','20261006000000_phase5_block4_review_queue',
--      '20261007000000_phase5_credit_app_one_active_per_deal','20261008000000_add_buyer_opportunity_intake_retry_terminal',
--      '20261009000000_add_deal_dealer_award_dispatch','20261010000000_batch1_inventory_matching_truthfulness',
--      '20261012000000_add_buyer_request_claim_token','20261013000000_esign_inhouse_evidence',
--      '20261017000000_migration_chain_functional_reconciliation','20261018000000_retire_misnamed_conversations_table',
--      '20261102000000_dealer_outreach_apollo_operational');
--
--   UPDATE _prisma_migrations m SET checksum = b.checksum
--     FROM _prisma_migrations_backup_20260831 b
--    WHERE b.migration_name = m.migration_name
--      AND m.migration_name IN (
--        '20260507000000_add_prequal_consent_accepted_at','20260702000000_add_admin_mfa_rate_limit',
--        '20260703000000_add_admin_pending_recovery_codes','20260703000000_add_pending_recovery_codes',
--        '20260801000005_affiliate_onboarding','20260911000000_add_acquisition_system');
--
--   -- confirm 67 before committing
--   SELECT count(*) FROM _prisma_migrations;
-- COMMIT;
