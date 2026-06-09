-- =====================================================
-- Session A — Intelligence Foundation
-- New content-franchise seeds for auction/offer urgency and dealer-growth.
--
-- Column names match the live content_franchises table created in
-- social_media_engine_tables.sql ("postingSlots" / "hookTypes" /
-- "requiresReview" are camelCase-quoted there, not snake_case). Idempotent via
-- ON CONFLICT (slug) so re-running is safe.
-- =====================================================
INSERT INTO content_franchises
  (id, slug, name, description, platforms, cadence,
   "postingSlots", "hookTypes", "requiresReview", active)
VALUES
  (gen_random_uuid(), 'auction_countdown',
   'Auction Countdown',
   'Urgency content for buyers with active auctions',
   ARRAY['facebook','instagram'],
   'daily', ARRAY[9,14],
   ARRAY['urgency','social_proof','savings'],
   true, true),

  (gen_random_uuid(), 'offer_received',
   'Offer Received Guide',
   'Help buyers compare and evaluate dealer offers',
   ARRAY['facebook','instagram'],
   'daily', ARRAY[9,14],
   ARRAY['curiosity','savings','comparison'],
   true, true),

  (gen_random_uuid(), 'dealer_growth',
   'Dealer Growth',
   'Content targeting dealers to join AutoLenis platform',
   ARRAY['linkedin','facebook'],
   'weekly', ARRAY[9],
   ARRAY['social_proof','savings','comparison'],
   false, true),

  (gen_random_uuid(), 'market_stats_dealer',
   'Market Stats for Dealers',
   'Weekly dealer competition and market intelligence',
   ARRAY['linkedin'],
   'weekly', ARRAY[9],
   ARRAY['social_proof','comparison'],
   false, true)
ON CONFLICT (slug) DO NOTHING;
