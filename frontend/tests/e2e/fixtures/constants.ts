// Shared constants for e2e gate fixtures + specs. Single source of truth so the
// seed script (scripts/seed-e2e-gates.ts) and the specs reference identical IDs.
// All accounts are scoped to @autolenis-test.com and created only against the
// non-prod E2E target.

export const GATE = {
  // Admin (token minted via jose in the helper; row created by the seed).
  adminId: "a0e2e000-0000-4000-8000-000000000001",
  adminEmail: "gate-admin@autolenis-test.com",

  // Dealer (logs in via the real /api/dealer/auth/signin API).
  dealerEmail: "gate-dealer@autolenis-test.com",
  dealerPassword: "GateDealer1!",

  // Buyers (log in via the real /auth/signin form). One per scenario to avoid
  // conflicting deal states on a single buyer.
  esignBuyerEmail: "gate-esign-buyer@autolenis-test.com",
  esignBuyerPassword: "GateBuyer1!",
  shortlistBuyerEmail: "gate-shortlist-buyer@autolenis-test.com",
  shortlistBuyerPassword: "GateBuyer1!",
  jumpBuyerEmail: "gate-jump-buyer@autolenis-test.com",
  jumpBuyerPassword: "GateBuyer1!",
  propBuyerEmail: "gate-prop-buyer@autolenis-test.com",
  propBuyerPassword: "GateBuyer1!",
  // Insurance scenario buyer (owns the SIGNED deal; the dealer does the scan).
  insuranceBuyerEmail: "gate-insurance-buyer@autolenis-test.com",

  // Deterministic deal IDs so specs reference them without a DB query.
  dealEsignId: "d0e2e000-0000-4000-8000-000000000002", // CONTRACT_PENDING — esign gate
  dealJumpId: "d0e2e000-0000-4000-8000-000000000003", // FINANCING_PENDING — illegal jump
  dealInsuranceId: "d0e2e000-0000-4000-8000-000000000004", // SIGNED, insurance NOT_STARTED
  dealPropId: "d0e2e000-0000-4000-8000-000000000005", // FINANCING_PENDING — propagation

  // Pickup QR token the dealer scan matches verbatim (pickup.qrCodeData).
  insuranceQrToken: "E2EGATE-INSURANCE-QR-TOKEN",
} as const;
