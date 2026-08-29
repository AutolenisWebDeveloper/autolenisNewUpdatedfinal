-- 002_affiliate_rls — enable Row Level Security on all 16 affiliate tables.
-- OWNER-GATED: separately applyable from 001_affiliate_correctness. Annotated
-- mirror for manual application: docs/plans/sql/002_affiliate_rls.sql.
--
-- The migration chain contains no RLS statements for any affiliate table (the
-- 20260918000000 hardening covered 9 other out-of-band tables). All affiliate
-- data access is Prisma (table owner, bypasses RLS) or the service-role key
-- (bypasses RLS); a repo-wide check found ZERO PostgREST/anon-key reads of
-- affiliate tables — so on production this is HARDENING (deny-all for anon /
-- authenticated PostgREST access), not a behavior change. On chain-provisioned
-- environments (previews, restores) it closes real exposure of PII and
-- financial tables via the anon key.
--
-- With RLS enabled and no policy, the tables are deny-all for anon and
-- authenticated — matching the 20260918000000 pattern. Idempotent: ENABLE ROW
-- LEVEL SECURITY is a no-op where already enabled.

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

-- VERIFY (expect 16 rows, all rowsecurity = true):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'
--   AND tablename IN ('affiliates','commissions','affiliate_payouts',
--     'affiliate_payout_methods','affiliate_payout_schedules',
--     'affiliate_documents','affiliate_profiles','affiliate_tax_profiles',
--     'affiliate_payment_profiles','affiliate_onboarding_reviews',
--     'affiliate_referrals','affiliate_clicks','affiliate_compliance_records',
--     'affiliate_tier_history','referral_milestones','referral_milestone_configs');
