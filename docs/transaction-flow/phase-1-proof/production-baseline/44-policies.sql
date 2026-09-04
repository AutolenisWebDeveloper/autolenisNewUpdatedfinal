-- PRODUCTION PHYSICAL SCHEMA — policies (23/23, none denied). All PERMISSIVE; none RESTRICTIVE.
SET search_path = public;

CREATE POLICY "Service role only" ON public.acquisition_conversations AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated can read admin_briefings" ON public.admin_briefings AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role bypass" ON public.admin_journey_notes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.admin_journey_unlocks AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_mfa_email_tokens_owner" ON public.admin_mfa_email_tokens AS PERMISSIVE FOR ALL USING ((admin_id = (( SELECT auth.uid() AS uid))::text));
CREATE POLICY "Service role bypass" ON public.affiliate_documents AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.affiliates AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.buyer_offer_review_items AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.buyer_offer_reviews AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.buyer_opportunities AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.buyers AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "deal_notes_admin_only" ON public.deal_notes AS PERMISSIVE FOR ALL USING (false);
CREATE POLICY "Service role bypass" ON public.dealer_offer_submissions AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.dealer_prospects AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.dealers AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.lead_scores AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated can read referral configs" ON public.referral_milestone_configs AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role only" ON public.search_cache AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.sms_opt_outs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage users" ON public.users AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.vehicle_offer_dealer_invites AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON public.vehicle_offers AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "vehicle_request_financing_owner" ON public.vehicle_request_financing AS PERMISSIVE FOR ALL USING ((vehicle_request_id IN ( SELECT vehicle_requests.id
   FROM vehicle_requests
  WHERE (vehicle_requests.buyer_id = (( SELECT auth.uid() AS uid))::text))));
