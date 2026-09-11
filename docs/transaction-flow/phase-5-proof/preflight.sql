-- Phase 5 preflight — run this BEFORE `prisma migrate deploy`, and show the COMPLETE
-- result in chat.
--
-- Every row returns CHECKED or BLOCK. A single BLOCK row stops the run. No CHECKED row
-- for a given assertion means the query did not run — also a stop, which is why each
-- assertion is written to emit a row unconditionally rather than to return nothing when
-- it passes.
--
-- Read-only: every statement is a SELECT. Run inside the server-enforced read-only
-- transaction shape CLAUDE.md mandates:
--
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-5-proof/preflight.sql

\pset footer off

-- ── A. The predecessor chain is in place ────────────────────────────────────
--
-- Phase 5 ALTERs four tables and indexes a fifth; three of those objects are Phase 1's.
-- If the Phase 1 wave is not applied, `CREATE UNIQUE INDEX ... ON sourcing_candidates`
-- fails on a table that does not exist and the whole migration aborts.
SELECT 'A1 sourcing_candidates exists (Phase 1 applied)' AS assertion,
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict,
       count(*)::text || ' table(s)' AS detail
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'sourcing_candidates'
UNION ALL
SELECT 'A2 identity_firewall_entries exists',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' table(s)'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
UNION ALL
SELECT 'A3 circumvention_attempts exists',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' table(s)'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'circumvention_attempts'
UNION ALL
SELECT 'A4 apollo_reveals exists',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' table(s)'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'apollo_reveals'
UNION ALL
SELECT 'A5 auction_invitations.candidate_ids exists (Phase 1 column)',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' column(s)'
  FROM information_schema.columns
 WHERE table_name = 'auction_invitations' AND column_name = 'candidate_ids'
UNION ALL
-- The immediate predecessor in the chain. Out-of-order application is how a ledger stops
-- being truthful.
SELECT 'A6 20261112000000_stage4_trade_election is applied and finished',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       coalesce(max(migration_name), 'absent')
  FROM _prisma_migrations
 WHERE migration_name = '20261112000000_stage4_trade_election'
   AND finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL
-- This migration must not already be recorded. If it is, `migrate deploy` will skip it
-- and the verification that follows would pass on objects a different run created.
SELECT 'A7 20261113000000_phase5_sourcing_invitations is NOT yet recorded',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' ledger row(s)'
  FROM _prisma_migrations
 WHERE migration_name = '20261113000000_phase5_sourcing_invitations'
UNION ALL
-- No failed or rolled-back row anywhere in the ledger. `migrate deploy` refuses to run
-- with a failed migration recorded, and the remedy is an owner-approved `migrate resolve`,
-- not a retry.
SELECT 'A8 no unfinished or rolled-back migration in the ledger',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' row(s): ' ||
         coalesce(string_agg(migration_name, ', '), 'none')
  FROM _prisma_migrations
 WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL

-- ── B. The two new uniques can be created ───────────────────────────────────
--
-- THE ONLY DATA-DEPENDENT BLOCKS IN THE FILE. `CREATE UNIQUE INDEX` fails on existing
-- duplicates and takes the whole migration with it, so both are asserted against real
-- rows rather than assumed from a row count.
UNION ALL
SELECT 'B1 no duplicate (sourcing_case_id, rooftop_id) in sourcing_candidates',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' duplicated pair(s)'
  FROM (
    SELECT sourcing_case_id, rooftop_id
      FROM sourcing_candidates
     WHERE rooftop_id IS NOT NULL
     GROUP BY sourcing_case_id, rooftop_id
    HAVING count(*) > 1
  ) d
UNION ALL
-- identity_firewall_entries cannot collide on a FIRST application: `auction_id` and
-- `rooftop_id` are created by this same migration, so every pre-existing row holds NULL in
-- both and PostgreSQL treats NULLs as distinct in a multicolumn unique index.
--
-- This file cannot query those columns before they exist — a static reference to a
-- missing column is a parse error, and a preflight that errors is a stop. So the
-- assertion is on the catalog: columns ABSENT is the first-application pass case.
-- If they are present, this is a re-run and the duplicate question is answered by the
-- `CREATE UNIQUE INDEX IF NOT EXISTS` already having succeeded once — plus verify.sql,
-- which reports the index itself.
SELECT 'B2 identity_firewall_entries.auction_id absent (first application, no collision possible)',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'CHECKED — re-run: columns already present' END,
       count(*)::text || ' column(s) present'
  FROM information_schema.columns
 WHERE table_name = 'identity_firewall_entries' AND column_name = 'auction_id'

-- ── C. The backfill size, so it is a number and not a hope ──────────────────
UNION ALL
SELECT 'C1 auction_invitations rows holding NULL candidate_ids (the backfill)',
       'CHECKED',
       count(*)::text || ' of ' ||
         (SELECT count(*)::text FROM auction_invitations) || ' row(s) to backfill'
  FROM auction_invitations
 WHERE candidate_ids IS NULL

-- ── D. State this phase's code will read, reported not gated ────────────────
--
-- Not BLOCKs. These are the numbers that make the post-deploy behaviour predictable, and
-- a surprise here is worth pausing on even though none of them prevents the DDL.
UNION ALL
SELECT 'D1 identity_firewall_entries row count (expected 0)',
       'CHECKED', count(*)::text || ' row(s)'
  FROM identity_firewall_entries
UNION ALL
SELECT 'D2 circumvention_attempts row count',
       'CHECKED', count(*)::text || ' row(s)'
  FROM circumvention_attempts
UNION ALL
SELECT 'D3 sourcing_cases / sourcing_candidates row counts',
       'CHECKED',
       (SELECT count(*)::text FROM sourcing_cases) || ' case(s), ' ||
       (SELECT count(*)::text FROM sourcing_candidates) || ' candidate(s)'
UNION ALL
SELECT 'D4 auction_invitations / outside_auction_invites row counts',
       'CHECKED',
       (SELECT count(*)::text FROM auction_invitations) || ' invitation(s), ' ||
       (SELECT count(*)::text FROM outside_auction_invites) || ' outside invite(s)'
UNION ALL
-- The pre-flip census, restated here so it is taken immediately before the run rather
-- than recalled from an earlier one. §13-D52's precondition (a) is that nothing is in
-- flight; a PENDING auction or an ACTIVE one with zero invitations is stranded by the
-- flip, because the reconciler's launch and close branches both stand down.
SELECT 'D5 PRE-FLIP: auctions PENDING (stranded by the flip if non-zero)',
       'CHECKED', count(*)::text || ' row(s)'
  FROM auctions WHERE status = 'PENDING'
UNION ALL
SELECT 'D6 PRE-FLIP: auctions ACTIVE with zero invitations of either kind',
       'CHECKED', count(*)::text || ' row(s)'
  FROM auctions a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (SELECT 1 FROM auction_invitations i WHERE i.auction_id = a.id)
   AND NOT EXISTS (SELECT 1 FROM outside_auction_invites o WHERE o.auction_id = a.id)
UNION ALL
SELECT 'D7 PRE-FLIP: LEGACY_PATH_WRITE / SETTLEMENT_AUCTION_LAUNCH rows to date',
       'CHECKED', count(*)::text || ' row(s)'
  FROM audit_logs
 WHERE action = 'LEGACY_PATH_WRITE'
   AND metadata ->> 'kind' = 'SETTLEMENT_AUCTION_LAUNCH'
UNION ALL
-- The rooftop facts §6b validates against, and the reason the D36 sub-ruling reads
-- operating_status as a NEGATIVE filter only: a predicate requiring 'ACTIVE' would
-- reject every rooftop, because nothing has ever written the column.
SELECT 'D8 dealer_rooftops with a non-null operating_status (expected 0)',
       'CHECKED',
       count(*)::text || ' of ' ||
         (SELECT count(*)::text FROM dealer_rooftops) || ' rooftop(s)'
  FROM dealer_rooftops WHERE operating_status IS NOT NULL
UNION ALL
SELECT 'D9 dealer_rooftops with a website_host (the Apollo domain key ceiling)',
       'CHECKED',
       count(*)::text || ' of ' ||
         (SELECT count(*)::text FROM dealer_rooftops) || ' rooftop(s)'
  FROM dealer_rooftops WHERE website_host IS NOT NULL
UNION ALL
-- The figure STOP 1 could not give: the send-safe share of dealer_contact_profiles is
-- what actually sizes the email-invitable pool, and it is not derivable from the
-- dealer_prospects email coverage.
SELECT 'D10 dealer_contact_profiles with a send-safe email (sizes the invitable pool)',
       'CHECKED',
       count(*)::text || ' of ' ||
         (SELECT count(*)::text FROM dealer_contact_profiles) || ' profile(s)'
  FROM dealer_contact_profiles
 WHERE email IS NOT NULL
   AND email_verification_status IN ('VERIFIED', 'ROLE_DERIVED')
UNION ALL
SELECT 'D11 distinct rooftops reachable by a send-safe email',
       'CHECKED',
       count(DISTINCT rooftop_id)::text || ' of ' ||
         (SELECT count(*)::text FROM dealer_rooftops) || ' rooftop(s)'
  FROM dealer_contact_profiles
 WHERE email IS NOT NULL
   AND email_verification_status IN ('VERIFIED', 'ROLE_DERIVED')
UNION ALL
-- Defect 1's live population: addresses AutoLenis' own one-click unsubscribe suppressed
-- with a SOFT reason, which the pre-phase invitation rail did not honour.
SELECT 'D12 email_suppression rows with a soft reason (unsubscribed / admin_added)',
       'CHECKED', count(*)::text || ' row(s)'
  FROM email_suppression
 WHERE reason IN ('unsubscribed', 'admin_added')
ORDER BY 1
;
