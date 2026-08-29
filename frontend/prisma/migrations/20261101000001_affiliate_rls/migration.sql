-- 002_affiliate_rls — reconcile affiliate-table RLS with the VERIFIED live state.
-- OWNER-GATED: separately applyable from 001_affiliate_correctness. Annotated
-- mirror for manual application: docs/plans/sql/002_affiliate_rls.sql.
--
-- ── What live production actually is (VERIFIED 2026-08-29, aieybibvewmvrubcpthm) ──
-- Query: SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policies p
--        WHERE p.tablename=c.relname) FROM pg_class c JOIN pg_namespace n ON
--        n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';
--
-- RLS is ALREADY ENABLED on ALL 16 tables below. An earlier revision of this
-- file assumed RLS was absent (from reading the migration chain) and framed
-- the ENABLEs as production hardening; that was wrong — on live production
-- every ENABLE below is a literal no-op. The live policy inventory
-- (pg_policies, same date):
--
--   • 13 tables: ZERO policies → deny-all for anon/authenticated PostgREST;
--     service_role bypasses RLS (relforcerowsecurity = false everywhere).
--   • affiliates, affiliate_documents: one policy each, "Service role bypass"
--     (PERMISSIVE, roles {service_role}, ALL, USING true, WITH CHECK true) —
--     grants nothing beyond what service_role already has (it bypasses RLS
--     unless FORCE is set); harmless and redundant. Left in place.
--   • referral_milestone_configs: "authenticated can read referral configs"
--     (PERMISSIVE, {authenticated}, SELECT, USING true) — any signed-in user
--     can read milestone config rows via PostgREST. Non-PII reference data;
--     judged intentional. Left in place.
--   • affiliate_payout_methods: "affiliate_payout_methods_owner"
--     (PERMISSIVE, {public}, ALL, USING affiliate_id = auth.uid()::text) —
--     the predicate compares Affiliate.id (a Prisma-generated uuid) to the
--     Supabase auth uid, two unrelated id spaces. VERIFIED it matches zero
--     rows today (SELECT count(*) FROM affiliates a JOIN users u ON
--     u.id=a.user_id WHERE a.id=u.supabase_id → 0), so it grants nothing in
--     practice — but it is a latent ALL-commands grant on banking-details
--     rows keyed to a predicate that was never true by construction. Dropped
--     below (behavior-neutral today; removes the latent surface). Owner may
--     strike that statement if the policy is wanted for a future id scheme.
--
-- ── What this migration therefore does ──
-- 1. ENABLE ROW LEVEL SECURITY on all 16 tables: a NO-OP on live production,
--    kept because CHAIN-PROVISIONED databases (CI, previews, restores built
--    from prisma/migrations) have no RLS on these tables at all — there this
--    closes real anon-key exposure of PII/financial tables.
-- 2. DROP the mismatched-predicate owner policy (no-op on chain databases,
--    which never had it).
-- This migration creates NO policies, so it cannot open access anywhere.
--
-- ── App impact: none ──
-- VERIFIED by grep on this branch: zero PostgREST `.from()` reads of any
-- affiliate table anywhere in app/, lib/, components/. The anon key appears
-- on the affiliate surface only inside @supabase/ssr auth-session validation
-- (lib/auth/affiliate-api.ts — auth.getUser from cookies), which does not
-- touch these tables. All affiliate data access is Prisma over the direct
-- connection, which RLS does not constrain here. 002 is a no-op for the
-- application in every environment.

ALTER TABLE "affiliates"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commissions"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_payouts"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_payout_methods"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_payout_schedules"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_documents"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_profiles"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_tax_profiles"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_payment_profiles"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_onboarding_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_referrals"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_clicks"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_compliance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_tier_history"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_milestones"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_milestone_configs"   ENABLE ROW LEVEL SECURITY;

-- Latent mismatched-predicate policy on banking-details rows (see header).
-- Behavior-neutral today: predicate VERIFIED to match 0 rows.
DROP POLICY IF EXISTS "affiliate_payout_methods_owner" ON "affiliate_payout_methods";

-- VERIFY (expect 16 rows, all rowsecurity = true):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'
--   AND tablename IN ('affiliates','commissions','affiliate_payouts',
--     'affiliate_payout_methods','affiliate_payout_schedules',
--     'affiliate_documents','affiliate_profiles','affiliate_tax_profiles',
--     'affiliate_payment_profiles','affiliate_onboarding_reviews',
--     'affiliate_referrals','affiliate_clicks','affiliate_compliance_records',
--     'affiliate_tier_history','referral_milestones','referral_milestone_configs');
-- VERIFY (expect 0 rows):
--   SELECT policyname FROM pg_policies
--   WHERE tablename='affiliate_payout_methods';
