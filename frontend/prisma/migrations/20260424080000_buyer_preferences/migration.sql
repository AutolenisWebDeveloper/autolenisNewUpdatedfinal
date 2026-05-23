-- Buyer notification and communication preferences.
-- One row per buyer. Defaults: email + auction alerts + deal updates ON; SMS + marketing OFF.

CREATE TABLE "buyer_preferences" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "email_notifications" BOOLEAN NOT NULL DEFAULT true,
    "sms_notifications" BOOLEAN NOT NULL DEFAULT false,
    "marketing_emails" BOOLEAN NOT NULL DEFAULT false,
    "auction_alerts" BOOLEAN NOT NULL DEFAULT true,
    "deal_updates" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_preferences_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyer_preferences')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "buyer_preferences_buyer_id_key" ON "buyer_preferences"("buyer_id");
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyer_preferences')) IS NOT NULL THEN
    ALTER TABLE "buyer_preferences" ADD CONSTRAINT "buyer_preferences_buyer_id_fkey"
        FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
