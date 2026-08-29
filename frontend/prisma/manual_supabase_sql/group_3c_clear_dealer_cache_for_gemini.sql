-- =====================================================
-- AutoLenis — Clear pre-Gemini dealer cache
-- Run before testing the Gemini Maps migration
-- =====================================================

-- Flush any cached dealer discovery results from Groq Compound
DELETE FROM search_cache
WHERE search_type = 'dealer_discovery';

-- OPTIONAL: clear hallucinated dealer prospects from test runs
-- Uncomment if you want a clean slate for the Gemini validation test
-- DELETE FROM dealer_prospects;
