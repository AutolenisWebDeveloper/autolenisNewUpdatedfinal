-- D1 — real per-dealer pickup availability (hours, timezone, blackout dates).
--
-- Additive + idempotent. Three new tables replace the Phase-1 CT-9–18 stub:
--   dealer_availability          — one row per dealer: canonical IANA timezone +
--                                  lead/advance bounds.
--   dealer_availability_windows  — per-weekday bookable windows (minutes-from-
--                                  midnight, local); multiple rows per weekday
--                                  express split hours.
--   dealer_blackout_dates        — closed date ranges (dealer-local, inclusive).
--
-- New tables get RLS enabled with no policy = deny-all for anon/authenticated
-- (all access is server-side via Prisma / service role, which bypass RLS),
-- matching every other table and the Supabase advisor (rls_disabled_in_public).
--
-- FKs are ON DELETE CASCADE: deleting a dealer removes its availability, and
-- deleting an availability row removes its windows + blackouts.
--
-- ⚠️ REQUIRED PRE-LIVE STEP: this migration must be applied to production with
--    `prisma migrate deploy`. The Vercel build does NOT run migrations.
--
-- Rollback:
--   DROP TABLE IF EXISTS "dealer_blackout_dates";
--   DROP TABLE IF EXISTS "dealer_availability_windows";
--   DROP TABLE IF EXISTS "dealer_availability";

CREATE TABLE IF NOT EXISTS "dealer_availability" (
  "id"                  TEXT NOT NULL,
  "dealer_id"           TEXT NOT NULL,
  "timezone"            TEXT NOT NULL,
  "timezone_overridden" BOOLEAN NOT NULL DEFAULT false,
  "min_lead_time_hours" INTEGER NOT NULL DEFAULT 24,
  "max_advance_days"    INTEGER NOT NULL DEFAULT 30,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dealer_availability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dealer_availability_dealer_id_fkey" FOREIGN KEY ("dealer_id")
    REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_availability_dealer_id_key" ON "dealer_availability"("dealer_id");
ALTER TABLE "dealer_availability" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "dealer_availability_windows" (
  "id"              TEXT NOT NULL,
  "availability_id" TEXT NOT NULL,
  "weekday"         INTEGER NOT NULL,
  "open_minute"     INTEGER NOT NULL,
  "close_minute"    INTEGER NOT NULL,
  CONSTRAINT "dealer_availability_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dealer_availability_windows_availability_id_fkey" FOREIGN KEY ("availability_id")
    REFERENCES "dealer_availability"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "dealer_availability_windows_availability_id_idx" ON "dealer_availability_windows"("availability_id");
ALTER TABLE "dealer_availability_windows" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "dealer_blackout_dates" (
  "id"              TEXT NOT NULL,
  "availability_id" TEXT NOT NULL,
  -- DATE (not TIMESTAMP): a blackout is a dealer-local calendar day; a bare DATE
  -- removes time-of-day/timezone ambiguity so the gate compares plain YYYY-MM-DD.
  "start_date"      DATE NOT NULL,
  "end_date"        DATE NOT NULL,
  "reason"          TEXT,
  CONSTRAINT "dealer_blackout_dates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dealer_blackout_dates_availability_id_fkey" FOREIGN KEY ("availability_id")
    REFERENCES "dealer_availability"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "dealer_blackout_dates_availability_id_idx" ON "dealer_blackout_dates"("availability_id");
ALTER TABLE "dealer_blackout_dates" ENABLE ROW LEVEL SECURITY;
