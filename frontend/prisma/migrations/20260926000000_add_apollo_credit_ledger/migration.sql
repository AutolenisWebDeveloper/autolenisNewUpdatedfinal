-- Block B / Apollo — reserve-and-release credit ledger + reveal cache/idempotency.
-- New tables get RLS enabled with no policy = deny-all for anon/authenticated
-- (all access is server-side via Prisma / service role, which bypass RLS).
--
-- Additive + idempotent. Rollback:
--   DROP TABLE IF EXISTS "apollo_reveals";
--   DROP TABLE IF EXISTS "apollo_credit_ledger";

CREATE TABLE IF NOT EXISTS "apollo_credit_ledger" (
  "id"            TEXT NOT NULL,
  "cycle_key"     TEXT NOT NULL,
  "cap_credits"   INTEGER NOT NULL,
  "spent_credits" INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apollo_credit_ledger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "apollo_credit_ledger_cycle_key_key" ON "apollo_credit_ledger"("cycle_key");
ALTER TABLE "apollo_credit_ledger" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "apollo_reveals" (
  "id"            TEXT NOT NULL,
  "rooftop_id"    TEXT NOT NULL,
  "cycle_key"     TEXT NOT NULL,
  "credits_cost"  INTEGER NOT NULL DEFAULT 0,
  "consumer"      TEXT NOT NULL DEFAULT 'live',
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "email"         TEXT,
  "email_status"  TEXT,
  "contact_name"  TEXT,
  "contact_title" TEXT,
  "revealed_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apollo_reveals_pkey" PRIMARY KEY ("id")
);
-- Unique claim per rooftop per cycle → same-rooftop concurrent/retried reveal
-- cannot double-draw (only the INSERT winner proceeds).
CREATE UNIQUE INDEX IF NOT EXISTS "apollo_reveals_rooftop_id_cycle_key_key" ON "apollo_reveals"("rooftop_id", "cycle_key");
CREATE INDEX IF NOT EXISTS "apollo_reveals_rooftop_id_idx" ON "apollo_reveals"("rooftop_id");
ALTER TABLE "apollo_reveals" ENABLE ROW LEVEL SECURITY;
