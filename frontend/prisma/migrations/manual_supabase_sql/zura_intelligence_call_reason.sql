-- AutoLenis Zura Intelligence Upgrade — Call Reason Tracking

ALTER TABLE buyer_opportunities
  ADD COLUMN IF NOT EXISTS call_reason TEXT;

CREATE INDEX IF NOT EXISTS buyer_opportunities_call_reason_idx
  ON buyer_opportunities (call_reason);
