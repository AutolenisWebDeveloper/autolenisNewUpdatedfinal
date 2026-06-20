-- Security hardening: enable Row Level Security on the 9 tables that were
-- created out of band (content platform, A/B testing, and the dealer
-- account-claim tokens) without RLS, leaving them inconsistent with the rest
-- of the schema (every other public table has RLS enabled).
--
-- With RLS enabled and no policy, these tables are deny-all for the anon and
-- authenticated roles — matching the established pattern. All legitimate access
-- is server-side via the Prisma connection (table owner, bypasses RLS) or the
-- Supabase service-role key (bypasses RLS), so this changes no application
-- behaviour while closing the exposure flagged by the Supabase security
-- advisor (rls_disabled_in_public). dealer_account_claim_tokens in particular
-- stores hashed, single-use claim tokens and must never be client-readable.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op on tables where it is
-- already enabled.

ALTER TABLE "ab_test_groups"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ab_test_variants"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_article_versions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_generation_jobs"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_generation_job_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_media_assets"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_validation_results"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_workflow_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dealer_account_claim_tokens"  ENABLE ROW LEVEL SECURITY;
