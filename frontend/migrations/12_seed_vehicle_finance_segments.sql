-- migrations/12_seed_vehicle_finance_segments.sql
-- Layer 5 — seed the spec's Vehicle and Finance segments as has_tag rules over
-- contacts.tags[]. Interest tags are projected onto contacts by the event spine
-- (lib/events/emit.ts → lib/crm/contact-interest-tags.ts) from vehicle-request,
-- trade-in, refinance, and calculator events. Idempotent: each insert is guarded
-- by name. contact_count starts at 0 / last_counted_at NULL; the Segments UI
-- recomputes the live count on next view.
--
-- Tag namespace: vehicle:<class>, finance:<kind>. Adds the Vehicle/Finance
-- segments deferred by migration 11.
-- Raw Supabase table — apply to prod ref aieybibvewmvrubcpthm ONLY.

INSERT INTO segments (name, description, conditions)
SELECT v.name, v.description, v.conditions::jsonb
FROM (VALUES
  -- Vehicle segments.
  ('Vehicle: SUV',
   'Contacts who expressed interest in an SUV.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"vehicle:suv"}]}'),
  ('Vehicle: Truck',
   'Contacts who expressed interest in a truck.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"vehicle:truck"}]}'),
  ('Vehicle: EV',
   'Contacts who requested an electric vehicle (EV make or model).',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"vehicle:ev"}]}'),
  ('Vehicle: Luxury',
   'Contacts who requested a luxury make or a high-budget vehicle.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"vehicle:luxury"}]}'),
  ('Vehicle: Family',
   'Contacts who requested a family vehicle (SUV or van).',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"vehicle:family"}]}'),
  -- Finance segments.
  ('Finance: Refinance',
   'Contacts who submitted a refinance inquiry.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"finance:refinance"}]}'),
  ('Finance: Trade-In',
   'Contacts who submitted a trade-in.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"finance:trade_in"}]}'),
  ('Finance: Financing',
   'Contacts who indicated they need financing.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"finance:financing"}]}'),
  ('Finance: Lease',
   'Contacts who expressed a lease preference.',
   '{"match":"all","rules":[{"field":"tags","op":"has_tag","value":"finance:lease"}]}')
) AS v(name, description, conditions)
WHERE NOT EXISTS (SELECT 1 FROM segments s WHERE s.name = v.name);
