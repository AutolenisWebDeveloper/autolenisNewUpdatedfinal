-- migrations/11_seed_named_segments.sql
-- Layer 5 — seed the spec's named segments as reusable rules over the CRM
-- contacts plane. Idempotent: each insert is guarded by name so re-running is a
-- no-op. contact_count starts at 0 / last_counted_at NULL; the Segments UI
-- (or any updateSegment call) recomputes the live count on next view.
--
-- Fields referenced (lead_score, lead_temperature, lifecycle_stage) are all
-- whitelisted in SegmentService.FIELD_DEFS, so these conditions also validate if
-- ever re-normalized through the service.
--
-- NOT seeded here: Vehicle segments (SUV/Truck/EV/Luxury/Family) and Finance
-- segments (Refinance/Trade-In/Financing/Lease). Those need a contact-level
-- interest field that does not yet exist on the contacts table (vehicle/finance
-- interest lives on BuyerOpportunity, not the CRM contact plane). Tracked as a
-- follow-up in _completion/09_crm_spec_gap_matrix.md (Layer 5).
-- Raw Supabase table — apply to prod ref aieybibvewmvrubcpthm ONLY.

INSERT INTO segments (name, description, conditions)
SELECT v.name, v.description, v.conditions::jsonb
FROM (VALUES
  -- Buyer segments (temperature / score driven by Layer-4 action scoring).
  ('Buyer: Cold',
   'Contacts with a cold lead temperature.',
   '{"match":"all","rules":[{"field":"lead_temperature","op":"eq","value":"cold"}]}'),
  ('Buyer: Warm',
   'Contacts with a warm lead temperature.',
   '{"match":"all","rules":[{"field":"lead_temperature","op":"eq","value":"warm"}]}'),
  ('Buyer: Hot',
   'Contacts with a hot lead temperature.',
   '{"match":"all","rules":[{"field":"lead_temperature","op":"eq","value":"hot"}]}'),
  ('Buyer: Ready To Buy',
   'Lead score at or above the ready-to-buy threshold (offer accepted or beyond).',
   '{"match":"all","rules":[{"field":"lead_score","op":"gte","value":200}]}'),
  -- Lifecycle segments (those mapping 1:1 to a contacts.lifecycle_stage value).
  ('Lifecycle: Lead',
   'Contacts at the lead stage.',
   '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"lead"}]}'),
  ('Lifecycle: Auction Active',
   'Contacts with an active auction.',
   '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"auction_active"}]}'),
  ('Lifecycle: Offer Received',
   'Contacts who have received at least one offer.',
   '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"offer_received"}]}'),
  ('Lifecycle: Customer',
   'Contacts who completed a purchase.',
   '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"purchase_completed"}]}')
) AS v(name, description, conditions)
WHERE NOT EXISTS (SELECT 1 FROM segments s WHERE s.name = v.name);
