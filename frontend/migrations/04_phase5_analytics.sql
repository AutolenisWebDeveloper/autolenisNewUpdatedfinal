-- ============================================================================
-- AutoLenis Phase 5 — Analytics + Operational Visibility
-- mv_funnel_metrics (materialized view) + refresh_analytics_views()
-- ============================================================================
-- The lifecycle funnel is the single most-asked dashboard slice across the
-- platform. Computing it from raw contacts on every dashboard hit costs a
-- table scan; the matview pre-aggregates by day so the CRM analytics view
-- reads a fixed-size, indexed surface no matter how many contacts exist.
--
-- The unique index on (day) is required for REFRESH MATERIALIZED VIEW
-- CONCURRENTLY — without it Postgres rejects the concurrent refresh and we
-- would have to lock the matview against readers during the daily 2am job.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FUNNEL MATERIALIZED VIEW
-- ============================================================================
-- One row per calendar day with cumulative stage counts. Stage filters are
-- *forward-inclusive* (a contact in purchase_completed counts in deposited,
-- auction_active, etc) so each column reads as "how many got at least this
-- far" — which is what the funnel chart needs to compute drop-off rates.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_funnel_metrics AS
SELECT
  date_trunc('day', created_at)::date AS day,
  COUNT(*) AS total_contacts,
  COUNT(*) FILTER (
    WHERE lifecycle_stage NOT IN ('lead')
  ) AS started_prequal,
  COUNT(*) FILTER (
    WHERE lifecycle_stage IN (
      'deposit_paid','auction_active','offer_received','purchase_completed'
    )
  ) AS deposited,
  COUNT(*) FILTER (
    WHERE lifecycle_stage IN (
      'auction_active','offer_received','purchase_completed'
    )
  ) AS auction_active,
  COUNT(*) FILTER (
    WHERE lifecycle_stage = 'purchase_completed'
  ) AS purchased
FROM contacts
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY 1 DESC;

-- Required for CONCURRENTLY refresh — also acts as the lookup path for the
-- "last N days" query the analytics dashboard executes.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mv_funnel_metrics_day
  ON mv_funnel_metrics(day);

-- ============================================================================
-- 2. REFRESH FUNCTION
-- ============================================================================
-- Wrapped in a SECURITY DEFINER function so the daily Inngest worker can call
-- it via supabase.rpc() without needing matview ownership granted to the
-- service role on every environment.

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_funnel_metrics;
END;
$$;

COMMIT;
