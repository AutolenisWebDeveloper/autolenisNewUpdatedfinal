-- System 4C: Add VehicleRequestFinancing model linked to VehicleRequest
-- Finance data is admin-visible only. Dealer surface shows only paymentMethod category.
-- leadQualityScore and adminBadge are computed server-side; never client-submitted.

CREATE TABLE "vehicle_request_financing" (
    "id"                           TEXT NOT NULL,
    "vehicle_request_id"           TEXT NOT NULL,
    "payment_method"               TEXT,
    "pre_approval_status"          TEXT,
    "lender_name"                  TEXT,
    "approved_amount_cents"        INTEGER,
    "quoted_apr"                   DECIMAL(5,3),
    "approval_expires_at"          TIMESTAMP(3),
    "down_payment_cents"           INTEGER,
    "monthly_payment_target_cents" INTEGER,
    "pre_approval_letter_url"      TEXT,
    "estimated_credit_range"       TEXT,
    "estimated_annual_income_cents" INTEGER,
    "proof_of_funds_available"     BOOLEAN,
    "max_budget_cents"             INTEGER,
    "lease_term_months"            INTEGER,
    "lease_miles_per_year"         INTEGER,
    "trade_in"                     BOOLEAN,
    "purchase_timeframe"           TEXT,
    "lead_quality_score"           INTEGER,
    "admin_badge"                  TEXT,
    "created_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_request_financing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_request_financing_vehicle_request_id_key" ON "vehicle_request_financing"("vehicle_request_id");

ALTER TABLE "vehicle_request_financing" ADD CONSTRAINT "vehicle_request_financing_vehicle_request_id_fkey"
    FOREIGN KEY ("vehicle_request_id") REFERENCES "vehicle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
