-- Phase 5 migration verification — the PHYSICAL half.
--
-- One row per object 20261113000000_phase5_sourcing_invitations is expected to produce.
-- Every row reports PRESENT or MISSING; a single MISSING row is a stop.
--
-- This file asserts the physical schema ONLY. `_prisma_migrations` is a separate
-- question and neither half is sufficient alone — see ledger.sql in this directory.
--
-- Read-only: every statement is a SELECT. Safe inside
-- `-c "SET TRANSACTION READ ONLY"`.

\pset footer off

-- ── 1. circumvention_attempts ───────────────────────────────────────────────
SELECT 'circumvention_attempts.initiator_role'                AS object,
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END AS state,
       coalesce(max(data_type), '-')                           AS detail
  FROM information_schema.columns
 WHERE table_name = 'circumvention_attempts' AND column_name = 'initiator_role'
UNION ALL
SELECT 'circumvention_attempts.after_paid_auction',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'circumvention_attempts' AND column_name = 'after_paid_auction'
UNION ALL
-- NULLABLE, not DEFAULT false. NULL is "not determined"; false is "determined, and
-- there was no paid auction". §25.2 gives those different consequences.
SELECT 'circumvention_attempts.after_paid_auction is nullable with no default',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(is_nullable) || ' / default=' || coalesce(max(column_default), 'none'), '-')
  FROM information_schema.columns
 WHERE table_name = 'circumvention_attempts' AND column_name = 'after_paid_auction'
   AND is_nullable = 'YES' AND column_default IS NULL
UNION ALL
SELECT 'circumvention_attempts.resolution',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'circumvention_attempts' AND column_name = 'resolution'
UNION ALL
SELECT 'circumvention_attempts.resolved_at',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'circumvention_attempts' AND column_name = 'resolved_at'
UNION ALL
SELECT 'index circumvention_attempts_dealer_id_detected_at_idx',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'circumvention_attempts'
   AND indexname = 'circumvention_attempts_dealer_id_detected_at_idx'

-- ── 2. identity_firewall_entries ────────────────────────────────────────────
UNION ALL
SELECT 'identity_firewall_entries.auction_id',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'auction_id'
UNION ALL
SELECT 'identity_firewall_entries.rooftop_id',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'rooftop_id'
UNION ALL
SELECT 'identity_firewall_entries.state',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'state'
UNION ALL
SELECT 'identity_firewall_entries.lifted_at',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'lifted_at'
UNION ALL
SELECT 'identity_firewall_entries.lifted_by',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type), '-')
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'lifted_by'
UNION ALL
-- THE RELAXATION. A withheld-state row carries no circumvention flag, so `flag` must be
-- nullable or launch readiness cannot write the §25.1 record at all.
SELECT 'identity_firewall_entries.flag is nullable (the one relaxation)',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(is_nullable), '-')
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'flag'
   AND is_nullable = 'YES'
UNION ALL
SELECT 'unique identity_firewall_entries_auction_id_rooftop_id_key',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'identity_firewall_entries'
   AND indexname = 'identity_firewall_entries_auction_id_rooftop_id_key'

-- ── 3. apollo_reveals ───────────────────────────────────────────────────────
UNION ALL
SELECT 'apollo_reveals.sourcing_case_id',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type) || ' / nullable=' || max(is_nullable), '-')
  FROM information_schema.columns
 WHERE table_name = 'apollo_reveals' AND column_name = 'sourcing_case_id'
UNION ALL
SELECT 'index apollo_reveals_sourcing_case_id_idx',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'apollo_reveals' AND indexname = 'apollo_reveals_sourcing_case_id_idx'
UNION ALL
-- DELIBERATELY NO FOREIGN KEY, matching this table's own `rooftop_id`, which has none.
-- A CASCADE from sourcing_cases would delete the record of credits actually spent.
SELECT 'apollo_reveals has no FK on sourcing_case_id (deliberate, soft key)',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       CASE WHEN count(*) = 0 THEN 'no FK, as intended' ELSE 'UNEXPECTED FK present' END
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
 WHERE t.relname = 'apollo_reveals' AND c.contype = 'f'
   AND pg_get_constraintdef(c.oid) LIKE '%sourcing_case_id%'

-- ── 4. sourcing_candidates ──────────────────────────────────────────────────
UNION ALL
SELECT 'unique sourcing_candidates_sourcing_case_id_rooftop_id_key',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'sourcing_candidates'
   AND indexname = 'sourcing_candidates_sourcing_case_id_rooftop_id_key'
UNION ALL
SELECT 'index sourcing_candidates_rooftop_id_idx',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'sourcing_candidates' AND indexname = 'sourcing_candidates_rooftop_id_idx'
UNION ALL
-- The pre-existing single-column index is REPORTED, not dropped: it is now a redundant
-- leftmost prefix of the composite unique, and dropping it is an owner decision.
SELECT 'index sourcing_candidates_case_idx still present (redundant, reported not dropped)',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'sourcing_candidates' AND indexname = 'sourcing_candidates_case_idx'

-- ── 5. auction_invitations.candidate_ids ────────────────────────────────────
UNION ALL
SELECT 'auction_invitations.candidate_ids is NOT NULL',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(is_nullable), '-')
  FROM information_schema.columns
 WHERE table_name = 'auction_invitations' AND column_name = 'candidate_ids'
   AND is_nullable = 'NO'
UNION ALL
SELECT 'auction_invitations.candidate_ids DEFAULT is an empty text[]',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(column_default), 'none')
  FROM information_schema.columns
 WHERE table_name = 'auction_invitations' AND column_name = 'candidate_ids'
   AND column_default LIKE '%ARRAY%'
UNION ALL
-- The backfill, proven by the absence of a NULL rather than asserted. `SET NOT NULL`
-- would itself have failed had any row still held NULL, so this row is belt and braces —
-- but it is the row that reads as evidence.
SELECT 'auction_invitations has no NULL candidate_ids row',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       count(*)::text || ' NULL rows'
  FROM auction_invitations
 WHERE candidate_ids IS NULL

-- ── Objects this migration must NOT have touched ────────────────────────────
UNION ALL
-- Phase 1's partial unique on (auction_id, rooftop_id) is the invitation dedup backstop
-- and S7-23 depends on it. A Phase 5 statement that replaced or dropped it would break
-- the one-invitation-per-rooftop invariant silently.
SELECT 'Phase 1 auction_invitations_auction_rooftop_key survives untouched',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE tablename = 'auction_invitations'
   AND indexname = 'auction_invitations_auction_rooftop_key'
UNION ALL
SELECT 'Phase 1 sourcing_cases_band_check survives untouched',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(pg_get_constraintdef(c.oid)), '-')
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
 WHERE t.relname = 'sourcing_cases' AND c.conname = 'sourcing_cases_band_check'
UNION ALL
-- ZERO POLICIES on every table this migration ALTERs. This is the invariant that matters
-- and it is absolute: adding a policy to a zero-policy table would OPEN access rather than
-- harden it, and the application reaches these tables as the table owner.
--
-- The RLS ENABLE-state is deliberately NOT asserted here as an absolute. It varies by
-- table — on a chain-built database `apollo_reveals` and `sourcing_candidates` carry
-- relrowsecurity=true (Phase 1's loop enables it on the tables that wave CREATED) while
-- `circumvention_attempts`, `identity_firewall_entries` and `auction_invitations` do not —
-- and production's own state is part of the known structural drift, so a fixed expectation
-- here would be wrong somewhere. The claim this migration makes is "untouched", and
-- untouched is proved by COMPARISON: run-proof.sh captures the enable-state before and
-- after and diffs it. An earlier draft of this file asserted "all 5 enabled" and failed on
-- its own wrong expectation rather than on the migration.
SELECT 'zero RLS policies on every table altered here',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       count(*)::text || ' policy/policies found'
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('circumvention_attempts', 'identity_firewall_entries',
                     'apollo_reveals', 'sourcing_candidates', 'auction_invitations')
;
