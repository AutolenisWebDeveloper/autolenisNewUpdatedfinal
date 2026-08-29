-- =====================================================
-- AutoLenis — Clear hallucinated dealer cache
-- One-time cleanup after fixing dealer discovery prompt
-- =====================================================

-- Clear all dealer_discovery cache entries so the next
-- buyer triggers a fresh, properly-verified search
DELETE FROM search_cache
WHERE search_type = 'dealer_discovery';

-- Optionally clear hallucinated dealer_prospects from test runs
-- (uncomment if you want to remove existing test data)
-- DELETE FROM dealer_prospects
-- WHERE status = 'DISCOVERED'
--   AND created_at < NOW();
