-- PRODUCTION PHYSICAL SCHEMA — triggers (29/29 non-internal, none denied).
-- Verbatim pg_get_triggerdef() output, unqualified function names resolved via search_path.
SET search_path = public;

CREATE TRIGGER acquisition_conversations_updated_at BEFORE UPDATE ON public.acquisition_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
CREATE TRIGGER trg_amips_market_scores_updated_at BEFORE UPDATE ON public.amips_market_scores FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER trg_amips_pages_updated_at BEFORE UPDATE ON public.amips_pages FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER trg_autolenis_intelligence_updated_at BEFORE UPDATE ON public.autolenis_intelligence FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER buyer_opportunities_updated_at BEFORE UPDATE ON public.buyer_opportunities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER content_articles_updated_at_trigger BEFORE UPDATE ON public.content_articles FOR EACH ROW EXECUTE FUNCTION update_content_articles_updated_at();
CREATE TRIGGER trg_content_attributions_updated_at BEFORE UPDATE ON public.content_attributions FOR EACH ROW EXECUTE FUNCTION set_content_attributions_updated_at();
CREATE TRIGGER set_content_franchises_updated_at BEFORE UPDATE ON public.content_franchises FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER trg_content_queue_updated_at BEFORE UPDATE ON public.content_queue FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER set_creator_attributions_updated_at BEFORE UPDATE ON public.creator_attributions FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER set_creator_network_updated_at BEFORE UPDATE ON public.creator_network FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER trg_dealer_intelligence_updated_at BEFORE UPDATE ON public.dealer_intelligence FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER dealer_prospects_updated_at BEFORE UPDATE ON public.dealer_prospects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_email_templates_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER financing_audit_events_no_delete BEFORE DELETE ON public.financing_audit_events FOR EACH ROW EXECUTE FUNCTION financing_audit_events_block_delete();
CREATE TRIGGER financing_audit_events_no_truncate BEFORE TRUNCATE ON public.financing_audit_events FOR EACH STATEMENT EXECUTE FUNCTION financing_audit_events_block_truncate();
CREATE TRIGGER financing_audit_events_no_update BEFORE UPDATE ON public.financing_audit_events FOR EACH ROW EXECUTE FUNCTION financing_audit_events_block_update();
CREATE TRIGGER trg_market_intelligence_updated_at BEFORE UPDATE ON public.market_intelligence FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER trg_marketplace_intelligence_updated_at BEFORE UPDATE ON public.marketplace_intelligence FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER set_posting_windows_updated_at BEFORE UPDATE ON public.posting_windows FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER set_revenue_attributions_updated_at BEFORE UPDATE ON public.revenue_attributions FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER trg_search_intelligence_updated_at BEFORE UPDATE ON public.search_intelligence FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
CREATE TRIGGER trg_segments_updated_at BEFORE UPDATE ON public.segments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_social_posts_updated_at BEFORE UPDATE ON public.social_posts FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER set_social_videos_updated_at BEFORE UPDATE ON public.social_videos FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();
CREATE TRIGGER trg_vehicle_intelligence_updated_at BEFORE UPDATE ON public.vehicle_intelligence FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();
