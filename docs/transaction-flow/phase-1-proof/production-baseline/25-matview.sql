CREATE MATERIALIZED VIEW public.mv_funnel_metrics AS
 SELECT date_trunc('day'::text, created_at)::date AS day,
    count(*) AS total_contacts,
    count(*) FILTER (WHERE lifecycle_stage <> 'lead'::text) AS started_prequal,
    count(*) FILTER (WHERE lifecycle_stage = ANY (ARRAY['deposit_paid'::text, 'auction_active'::text, 'offer_received'::text, 'purchase_completed'::text])) AS deposited,
    count(*) FILTER (WHERE lifecycle_stage = ANY (ARRAY['auction_active'::text, 'offer_received'::text, 'purchase_completed'::text])) AS auction_active,
    count(*) FILTER (WHERE lifecycle_stage = 'purchase_completed'::text) AS purchased
   FROM contacts
  WHERE deleted_at IS NULL
  GROUP BY (date_trunc('day'::text, created_at)::date)
  ORDER BY (date_trunc('day'::text, created_at)::date) DESC;
