-- Make.com cutover, Tranche T2 (H1) — unify SMS opt-out into one canonical store.
-- Before: two inbound webhooks wrote two divergent stores — the canonical
-- sms_suppression (read by SuppressionService → CRM dispatch, Inngest, QStash,
-- admin reply) and the Prisma SmsOptOut table (sms_opt_outs), with opposite
-- START semantics. /api/twilio/sms/inbound now writes sms_suppression via
-- SuppressionService and no longer auto-resubscribes on START. This backfills
-- any historical sms_opt_outs rows so no prior opt-out is lost.
-- Idempotent: ON CONFLICT + NOT EXISTS make repeated runs a no-op.

INSERT INTO sms_suppression (phone, reason, suppressed_at)
SELECT o.phone, 'stop', COALESCE(o.created_at, now())
FROM sms_opt_outs o
WHERE NOT EXISTS (
  SELECT 1 FROM sms_suppression s WHERE s.phone = o.phone
)
ON CONFLICT (phone) DO NOTHING;

-- Verification (expect every opted-out phone present in sms_suppression):
-- SELECT count(*) FROM sms_opt_outs o
--   WHERE NOT EXISTS (SELECT 1 FROM sms_suppression s WHERE s.phone = o.phone);
