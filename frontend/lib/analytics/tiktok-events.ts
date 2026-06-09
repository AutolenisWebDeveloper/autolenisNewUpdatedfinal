// TikTok Pixel conversion-event helpers for AutoLenis.
//
// Each helper is a safe no-op on the server and before the pixel script has
// loaded (`window.ttq` undefined), so callers can fire them unconditionally
// without guarding for environment.

// Fire on vehicle request submission
export function trackVehicleRequest(params: {
  make?: string;
  model?: string;
  budget?: number;
  city?: string;
}) {
  if (typeof window === "undefined" || !window.ttq) return;
  window.ttq.track("SubmitForm", {
    content_type: "vehicle_request",
    content_name:
      params.make && params.model
        ? `${params.make} ${params.model}`
        : "Vehicle Request",
    value: params.budget ?? 0,
    currency: "USD",
    description: params.city ?? "",
  });
}

// Fire on deposit payment ($99 fee)
export function trackDepositPayment(amountCents: number) {
  if (typeof window === "undefined" || !window.ttq) return;
  window.ttq.track("CompletePayment", {
    content_type: "auction_access_fee",
    value: amountCents / 100,
    currency: "USD",
  });
}

// Fire on buyer signup
export function trackBuyerSignup() {
  if (typeof window === "undefined" || !window.ttq) return;
  window.ttq.track("CompleteRegistration", {
    content_type: "buyer_account",
  });
}

// Fire on LP form step complete
export function trackLPFormStep(step: number, campaign: string) {
  if (typeof window === "undefined" || !window.ttq) return;
  window.ttq.track("ClickButton", {
    content_type: "lp_form",
    content_name: `step_${step}`,
    description: campaign,
  });
}

// Fire on offer received (buyer sees dealer offers)
export function trackOfferReceived(offerCount: number) {
  if (typeof window === "undefined" || !window.ttq) return;
  window.ttq.track("ViewContent", {
    content_type: "dealer_offers",
    content_name: "offers_received",
    value: offerCount,
  });
}
