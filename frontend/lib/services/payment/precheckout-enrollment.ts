import { dispatch } from "@/lib/qstash/dispatch";
import {
  enqueueLifecycleTouch,
  cancelPreCheckoutTouches,
  preCheckoutBaseKey,
} from "@/lib/services/crm/lifecycle-touch-drain.service";

// ---------------------------------------------------------------------------
// $99 PRE-CHECKOUT conversion ENROLLMENT — single-authority selector.
//
// Stage 1 of the funnel: a saved competitive request whose lead has not yet
// reached checkout. Two producers can drive it — the legacy QStash job
// (`/api/jobs/form-submitted` → `check-form-completion`) and the internal
// Program-2 lifecycle scheduler (`lifecycle_touch_schedule`, form_submitted →
// check_form_completion_*). They must NEVER both run.
//
//   PRECHECKOUT_CONVERSION_INTERNAL_ENABLED !== "true" → QStash (DEFAULT / current)
//   PRECHECKOUT_CONVERSION_INTERNAL_ENABLED === "true" → internal lifecycle_touch
//
// Default preserves the current production authority (QStash). Cutover is a single
// owner-gated flag flip (mirrors DEPOSIT_REMINDER_INTERNAL_ENABLED), after the
// owner applies the lifecycle_touch_schedule SQL + the buyer_request_claim_tokens
// migration and retires the QStash producer — one authority at all times. The
// internal path carries the truthful $99 copy + the secure resume link; the QStash
// legacy path is unchanged until cutover. Concierge leads are excluded by the
// caller (they never enroll in this generic funnel).
// ---------------------------------------------------------------------------

export type PreCheckoutAuthority = "internal" | "qstash";

export function preCheckoutAuthority(): PreCheckoutAuthority {
  return process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED === "true" ? "internal" : "qstash";
}

export interface EnrollPreCheckoutInput {
  buyerId: string;
  firstName: string | null;
  email: string;
  phone?: string | null;
  /** Legacy QStash producer carries a campaign tag; ignored by the internal path. */
  campaign?: string | null;
}

// Enroll a saved, unpaid competitive request into the $99 pre-checkout stage.
// Idempotent per authority (internal: enqueue-once on UNIQUE(base_key, sequence);
// QStash job self-stops once converted). The welcome (form_submitted) fires
// immediately; check_form_completion chains at +1h/+24h/+72h.
export async function enrollPreCheckout(
  input: EnrollPreCheckoutInput,
): Promise<{ authority: PreCheckoutAuthority; enrolled: boolean }> {
  const authority = preCheckoutAuthority();

  if (authority === "internal") {
    const { scheduled } = await enqueueLifecycleTouch({
      sequence: "form_submitted",
      entityId: input.buyerId,
      firstName: input.firstName,
      email: input.email,
      phone: input.phone ?? null,
      baseKey: preCheckoutBaseKey(input.buyerId),
      // Welcome fires now; the chain adds the +1h/+24h/+72h follow-ups.
      runAt: new Date(),
    });
    return { authority, enrolled: scheduled };
  }

  await dispatch({
    path: "/api/jobs/form-submitted",
    body: {
      buyerId: input.buyerId,
      firstName: input.firstName,
      email: input.email,
      phone: input.phone ?? null,
      campaign: input.campaign ?? "default",
    },
  });
  return { authority, enrolled: true };
}

// Stop a buyer's remaining pre-checkout touches (the handoff, called from
// create-intent the moment a competitive PENDING deposit is created). The
// internal path cancels its rows; the QStash job self-stops via its guard.
// Best-effort by construction.
export async function cancelPreCheckoutEnrollment(
  buyerId: string,
  reason = "checkout_started",
): Promise<void> {
  await cancelPreCheckoutTouches(buyerId, { reason });
}
