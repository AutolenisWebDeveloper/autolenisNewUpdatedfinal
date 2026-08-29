-- =====================================================
-- AutoLenis Group 2 — BuyerOpportunity Migration
-- Run this in Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS buyer_opportunities (
  id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  session_id TEXT NOT NULL,
  conversation_id TEXT,

  buyer_id TEXT,
  phone TEXT,
  first_name TEXT,

  vehicle_type TEXT,
  make TEXT,
  model TEXT,
  body_style TEXT,
  year_min INTEGER,
  year_max INTEGER,
  trim TEXT,

  budget_type TEXT,
  budget_amount INTEGER,
  monthly_payment INTEGER,

  timeline TEXT,
  zip TEXT,

  has_trade_in BOOLEAN,
  trade_in_details JSONB,

  financing_needed BOOLEAN,

  messages JSONB NOT NULL DEFAULT '[]'::JSONB,
  completed BOOLEAN NOT NULL DEFAULT false,

  lead_score INTEGER,
  lead_temperature TEXT,
  scoring_reason TEXT,

  founder_notified BOOLEAN NOT NULL DEFAULT false,
  buyer_sms_sent BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT buyer_opportunities_pkey PRIMARY KEY (id),
  CONSTRAINT buyer_opportunities_session_id_key UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS buyer_opportunities_buyer_id_idx
  ON buyer_opportunities (buyer_id);

CREATE INDEX IF NOT EXISTS buyer_opportunities_temperature_idx
  ON buyer_opportunities (lead_temperature);

CREATE INDEX IF NOT EXISTS buyer_opportunities_created_at_idx
  ON buyer_opportunities (created_at DESC);

CREATE INDEX IF NOT EXISTS buyer_opportunities_phone_idx
  ON buyer_opportunities (phone);

-- Auto-update updated_at trigger
DROP TRIGGER IF EXISTS buyer_opportunities_updated_at
  ON buyer_opportunities;

CREATE TRIGGER buyer_opportunities_updated_at
  BEFORE UPDATE ON buyer_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policy
ALTER TABLE buyer_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON buyer_opportunities;
CREATE POLICY "Service role only"
  ON buyer_opportunities
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
