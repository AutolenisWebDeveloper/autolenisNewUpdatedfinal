// lib/services/notifications/acquisition-comms.ts
//
// AutoLenis — Acquisition lifecycle communication orchestrator.
//
// PURPOSE
// -------
// A single, event-driven seam that turns a durable acquisition-lifecycle state
// transition into a proactive, consent-aware, idempotent, auditable customer
// message across the channels AutoLenis already owns. It implements the
// prescribed pipeline:
//
//   Domain event  →  Plan (template/content)  →  Channel eligibility (prefs)
//     →  Event-level idempotency latch  →  Send (in-app + gated SMS)
//     →  Delivery/outcome recorded  →  audit metadata on the Notification
//
// WHY THIS EXISTS (reuse-before-create notes)
// -------------------------------------------
// The buyer-facing post-acceptance lifecycle (`advanceDealStatus`) previously
// sent the customer NOTHING — the intended `BuyerTriggers` catalog in
// `notification.service.ts` was dead code, and transactional emails were fired
// ad hoc from a handful of routes only. This module does not fork a new comms
// system; it composes the EXISTING infrastructure:
//   - in-app  : the existing `Notification` model (channel = IN_APP)
//   - SMS     : the hardened `sendCrmSms` path (TCPA consent + `SuppressionService`
//               + recipient-local quiet hours). Off by default — opt in with
//               ACQUISITION_COMMS_SMS_ENABLED=true (governance: outreach stays
//               disabled until reviewed).
//   - idempotency : the shared `idempotency_keys` guard (lib/jobs/idempotency),
//               NOT a new dedup table.
//   - preferences : `notification-preference.service` (inAppEnabled gate).
//
// NON-DUPLICATION (important):
//   * SMS is a channel the deal lifecycle previously had NONE of, so emitting it
//     from the single `advanceDealStatus` seam can never duplicate an existing
//     message. The orchestrator owns SMS for every action-required transition.
//   * IN-APP is partially owned by existing callers today: several routes/services
//     already create a buyer `Notification` CO-LOCATED with the transition
//     (SIGNED, PICKUP_SCHEDULED, COMPLETED, CANCELLED, REFUNDED, CONTRACT_APPROVED —
//     see `INAPP_OWNED_BY_CALLERS`). To avoid double in-app notifications WITHOUT
//     editing those callers (and losing their dynamic content), the orchestrator
//     SKIPS in-app for exactly those statuses and OWNS in-app for the transitions
//     that were genuinely silent (financing, fee, insurance, contract prep/review,
//     signing, pickup-complete). Full in-app centralization — collapsing the
//     caller notifications into this seam — is a deliberate, separately-reviewed
//     follow-up.
//
// Email is deliberately NOT dispatched from here: the transitions already emit
// their own transactional email where appropriate (resend.service), and adding
// email here would risk double-sends. Consolidating the email plane behind a
// single consent gate is tracked as a separate, broader refactor.
//
// TEST-SAFETY
// -----------
// Top-level imports are limited to test-safe modules (prisma, logger, @prisma/client,
// the preference service). The `server-only` SMS + service-role Supabase deps are
// lazy-imported inside the dispatch path so this module (and its importer
// `deal.service`) can be loaded by the Node test runner without pulling in
// `server-only`.

import { prisma } from "@/lib/prisma";
import { NotificationType, type DealStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getPreferences } from "./notification-preference.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").trim();

// Deep-link destinations (relative). Kept here so the plan table stays readable.
const BUYER_DEAL = "/buyer/deal";
const BUYER_INSURANCE = "/buyer/insurance";
const BUYER_CONTRACT_SHIELD = "/buyer/contract-shield";
const BUYER_ESIGN = "/buyer/esign";
const BUYER_PICKUP = "/buyer/pickup";

// ───────────────────────────────────────────────────────────────────────────
// PURE CORE  (no I/O — unit-tested directly, matching the repo's state-machine
// test convention)
// ───────────────────────────────────────────────────────────────────────────

export interface DealCommPlan {
  /** Maps to the existing NotificationType enum. */
  type: NotificationType;
  /** In-app notification title. */
  title: string;
  /** In-app notification body. */
  body: string;
  /** Buyer portal deep-link (relative path). */
  actionUrl: string;
  /** True when the buyer must do something next (drives CTA + SMS candidacy). */
  actionRequired: boolean;
  /**
   * Short SMS body (without the opt-out disclosure, which `sendCrmSms` appends,
   * and without the URL, which the dispatcher appends). `null` = this event does
   * not warrant an SMS (keeps texting to genuinely useful moments).
   */
  sms: string | null;
}

/**
 * The single source of truth mapping a post-acceptance DealStatus to the
 * customer communication for that transition. Returns `null` for pre-financing
 * internal states (PENDING/ACTIVE) which carry no buyer-facing message.
 *
 * Pure and total over DealStatus.
 */
export function dealStatusCommsPlan(status: DealStatus): DealCommPlan | null {
  switch (status) {
    case "PENDING":
    case "ACTIVE":
      // Internal pre-financing states — the buyer is notified at deal creation
      // (DEAL_SELECTED) by the offer-selection path, not here.
      return null;

    case "FINANCING_PENDING":
      return {
        type: NotificationType.DEAL_SELECTED,
        title: "Next step: choose your financing",
        body: "Your deal is confirmed. Choose how you'd like to finance your purchase to keep things moving.",
        actionUrl: BUYER_DEAL,
        actionRequired: true,
        sms: "Your AutoLenis deal is confirmed — choose your financing to continue:",
      };

    case "FEE_PENDING":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Concierge service fee due",
        body: "Complete your AutoLenis concierge service fee to move your deal forward.",
        actionUrl: BUYER_DEAL,
        actionRequired: true,
        sms: "Action needed: complete your AutoLenis concierge service fee to keep your deal moving:",
      };

    case "FEE_PAID":
      return {
        type: NotificationType.FEE_PAID,
        title: "Service fee received",
        body: "Thanks — your concierge service fee is confirmed. We're advancing your deal.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: null,
      };

    case "INSURANCE_PENDING":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Add your proof of insurance",
        body: "Add or verify your insurance so we can finalize your purchase.",
        actionUrl: BUYER_INSURANCE,
        actionRequired: true,
        sms: "Action needed: add or verify your insurance to finalize your AutoLenis purchase:",
      };

    case "CONTRACT_PENDING":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Your contract is being prepared",
        // Track-neutral by necessity: a concierge deal has no dealer at all
        // (Deal.offerId is null and VehicleRequestOffer carries no dealer
        // identity), so naming one was false for that whole track.
        body: "We're preparing your contract. We'll let you know the moment it's ready.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: null,
      };

    case "CONTRACT_REVIEW":
      return {
        type: NotificationType.CONTRACT_READY,
        title: "Contract Shield is reviewing your contract",
        body: "Our Contract Shield team is checking your contract for junk fees and discrepancies.",
        actionUrl: BUYER_CONTRACT_SHIELD,
        actionRequired: false,
        sms: null,
      };

    case "CONTRACT_APPROVED":
      return {
        type: NotificationType.CONTRACT_APPROVED,
        title: "Contract approved by Contract Shield",
        body: "Contract Shield approved your contract. You're clear to sign — your signing package is next.",
        actionUrl: BUYER_CONTRACT_SHIELD,
        actionRequired: false,
        // No SMS here: SIGNING_PENDING immediately follows and carries the CTA,
        // so we avoid two texts back-to-back.
        sms: null,
      };

    case "SIGNING_PENDING":
      return {
        type: NotificationType.SIGNING_READY,
        title: "Documents ready to sign",
        body: "Your signing package is ready. Complete e-signing to finalize your purchase.",
        actionUrl: BUYER_ESIGN,
        actionRequired: true,
        sms: "Your AutoLenis documents are ready to sign — complete e-signing here:",
      };

    case "SIGNED":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Documents signed",
        body: "Your documents are signed. We're coordinating the final steps to pickup.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: null,
      };

    case "PICKUP_SCHEDULED":
      return {
        type: NotificationType.PICKUP_SCHEDULED,
        title: "Pickup scheduled",
        body: "Your vehicle pickup is scheduled. View the details and your pickup QR code.",
        actionUrl: BUYER_PICKUP,
        actionRequired: true,
        sms: "Your AutoLenis vehicle pickup is scheduled — view the details and your QR code:",
      };

    case "PICKUP_COMPLETE":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Vehicle picked up",
        body: "Enjoy your new vehicle! We're wrapping up the final paperwork.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: null,
      };

    case "COMPLETED":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Your purchase is complete 🎉",
        body: "Congratulations! Your AutoLenis purchase is complete. Thank you for choosing us.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: "Congratulations — your AutoLenis purchase is complete! View your deal summary:",
      };

    case "CANCELLED":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Your deal was cancelled",
        body: "Your deal has been cancelled. Contact us if you have questions or would like to start again.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: "Your AutoLenis deal was cancelled. Contact us with any questions:",
      };

    case "REFUNDED":
      return {
        type: NotificationType.DEAL_STAGE_CHANGED,
        title: "Your refund has been processed",
        body: "Your refund has been processed. Please allow a few business days for it to appear.",
        actionUrl: BUYER_DEAL,
        actionRequired: false,
        sms: "Your AutoLenis refund has been processed. Allow a few business days for it to appear:",
      };

    // Phase 1 transaction spine (20261106000000). The guard below demands an explicit
    // plan or an explicit null for every new DealStatus; these seven are given an
    // explicit null because nothing in Phase 1 can put a deal into them, so there is
    // no event to tell the buyer about yet. The phases that own each state supply the
    // copy — and until they do, this sends nothing rather than sending something wrong.
    case "DEALER_CONFIRMATION":
    case "RECAP_PENDING":
    case "DEALER_EXECUTED":
    case "FUNDING_PENDING":
    case "PICKUP_READINESS":
    case "HANDOVER_PENDING":
    case "FROZEN_PENDING_RELEASE":
      return null;

    default: {
      // Exhaustiveness guard — a new DealStatus must be given an explicit plan
      // (or an explicit `null`) rather than silently sending nothing.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Stable, event-scoped idempotency key for a deal-status communication. Keyed on
 * (deal, target status, buyer) so re-emitting the same transition — a retry, a
 * concurrent double-advance, or a duplicate event — converges to one dispatch.
 * Pure.
 */
export function dealCommsIdempotencyKey(
  dealId: string,
  status: DealStatus,
  buyerId: string,
): string {
  return `acq-comms:deal:${dealId}:${status}:${buyerId}`;
}

/**
 * DealStatus transitions whose buyer IN-APP notification is already created by an
 * existing caller CO-LOCATED with the transition (verified against the codebase):
 *   - PICKUP_SCHEDULED  → pickup.service.schedulePickup
 *   - COMPLETED         → pickup.service.completePickup / admin deals action /
 *                         admin pickup-complete route
 *   - CANCELLED         → admin deals action route
 *   - REFUNDED          → admin deals action route
 *   - CONTRACT_APPROVED → admin contract-shield route
 *
 * The orchestrator SKIPS in-app for these to avoid double-notifying the buyer,
 * while still owning the SMS channel for them. Keep this list in sync if a caller
 * stops creating its own in-app notification for one of these transitions.
 */
export const INAPP_OWNED_BY_CALLERS: ReadonlySet<DealStatus> = new Set<DealStatus>([
  // SIGNED is deliberately ABSENT. It used to be delegated to a DocuSign-era
  // esign.service handler that was deleted with the provider — the ownership entry
  // outlived its owner, so the orchestrator skipped the in-app
  // notification and nothing created one. Combined with `sms: null` on the SIGNED
  // plan, the moment a buyer's contract became binding produced no notification on
  // any channel. The orchestrator now owns it, as it does for every other
  // genuinely-silent transition.
  "PICKUP_SCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
  "CONTRACT_APPROVED",
]);

/** True when an existing caller already creates the buyer in-app notification for
 * this transition (so the orchestrator must not also create one). Pure. */
export function isInAppOwnedByCaller(status: DealStatus): boolean {
  return INAPP_OWNED_BY_CALLERS.has(status);
}

export interface ChannelDecision {
  inApp: boolean;
  sms: boolean;
}

/**
 * Decide which channels are CANDIDATES for a plan given the buyer's in-app
 * preference and whether the SMS feature is enabled. Pure.
 *
 * Note: SMS candidacy here is necessary-but-not-sufficient — the actual send is
 * still hard-gated by TCPA consent, suppression, and quiet hours inside
 * `sendCrmSms`. This function never decides to bypass those gates.
 */
export function resolveChannels(input: {
  plan: DealCommPlan;
  inAppEnabled: boolean;
  smsFeatureEnabled: boolean;
}): ChannelDecision {
  return {
    inApp: input.inAppEnabled,
    sms: input.smsFeatureEnabled && input.plan.sms !== null,
  };
}

/** SMS feature flag — off by default (governance: outreach disabled until reviewed). */
export function smsFeatureEnabled(): boolean {
  return process.env.ACQUISITION_COMMS_SMS_ENABLED === "true";
}

// ───────────────────────────────────────────────────────────────────────────
// DISPATCH SHELL  (impure — best-effort, never throws to the caller)
// ───────────────────────────────────────────────────────────────────────────

export type SmsOutcome =
  | "sent"
  | "no_consent"
  | "suppressed"
  | "quiet_hours"
  | "invalid_phone"
  | "not_configured"
  | "failed"
  | "no_contact"
  | "disabled";

export interface EmitResult {
  status: "sent" | "deduped" | "skipped" | "no_buyer" | "guard_unavailable";
  inApp: boolean;
  sms: SmsOutcome;
}

/**
 * Emit the proactive customer communication for a deal-status transition.
 *
 * Best-effort and non-throwing: a failure in any channel is logged and never
 * propagates to the caller (so it can be awaited safely inside the guarded
 * `advanceDealStatus` seam in request, cron, and Inngest contexts alike).
 */
export async function emitDealStatusComms(
  dealId: string,
  status: DealStatus,
): Promise<EmitResult> {
  try {
    const plan = dealStatusCommsPlan(status);
    if (!plan) return { status: "skipped", inApp: false, sms: "disabled" };

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        buyerId: true,
        buyer: {
          select: {
            firstName: true,
            phone: true,
            state: true,
            zip: true,
            userId: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    if (!deal?.buyerId || !deal.buyer) {
      return { status: "no_buyer", inApp: false, sms: "no_contact" };
    }
    const buyerId = deal.buyerId;
    const buyer = deal.buyer;

    // ── Event-level idempotency latch — §8.2 Phase 10 defect (5) ───────────────
    //
    // THIS WAS FAIL-OPEN IN THREE PLACES, not the two the defect list names:
    //
    //   1. `if (guardSupabase)` — when `getGuardSupabase()` returned null (either
    //      required env name unset, or the import threw) the ENTIRE latch was skipped
    //      with no log and no signal. Not a degraded guard: no guard at all, silently.
    //   2. the `catch` below it, which logged "proceeding" and sent anyway.
    //   3. the terminal-outcome write further down, same shape.
    //
    // The old comment justified (2) as "a missing latch must not silence a real
    // notification", and that trade was defensible when nothing else deduplicated.
    // §27 removes the premise: "All transactional email, SMS, and in-app notices
    // dispatch through the durable outbox with … an idempotency key", and
    // `comms_outbox.dedup_key` is a UNIQUE constraint — dedup enforced by the
    // database, which cannot fail open. §8.2 says this guard is "superseded by the
    // outbox `dedup_key`".
    //
    // WHAT CHANGES HERE, AND WHAT DOES NOT. This path still sends in-app and SMS
    // directly rather than through the dispatcher — moving it is the remaining half
    // and is recorded as such in §8.1j. What changes is the failure direction: a
    // guard that cannot be consulted now REFUSES and raises a COMMS_EXCEPTION, so an
    // unguarded send becomes an Operations case instead of a duplicate a buyer
    // receives twice with nothing recorded. §28.3 #8 — every failure has an owner
    // and a return path — and the return path is that the exception carries the key,
    // so the send can be re-driven once the guard is back.
    const key = dealCommsIdempotencyKey(dealId, status, buyerId);
    const guardSupabase = await getGuardSupabase();
    if (!guardSupabase) {
      await raiseCommsGuardException(dealId, buyerId, key, "the idempotency guard is not configured");
      return { status: "guard_unavailable", inApp: false, sms: "disabled" };
    }
    try {
      const { acquireIdempotencyGuard } = await import("@/lib/jobs/idempotency");
      const claimed = await acquireIdempotencyGuard(guardSupabase, key);
      if (!claimed) return { status: "deduped", inApp: false, sms: "disabled" };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.error("[acq-comms] idempotency guard failed — refusing to send unguarded", { key, detail });
      await raiseCommsGuardException(dealId, buyerId, key, detail);
      return { status: "guard_unavailable", inApp: false, sms: "disabled" };
    }

    // ── Channel eligibility ───────────────────────────────────────────────────
    // In-app is gated by (a) the buyer's preference AND (b) whether an existing
    // caller already owns the in-app notification for this transition (skip to
    // avoid duplicates). SMS is never owned by a caller, so it is gated only by
    // the feature flag + preference + the plan's own SMS candidacy.
    let inAppPref = true;
    try {
      const pref = await getPreferences(buyer.userId);
      if (pref && pref.inAppEnabled === false) inAppPref = false;
    } catch (err) {
      logger.error("[acq-comms] preference lookup failed — defaulting to enabled:", err);
    }
    const channels = resolveChannels({
      plan,
      inAppEnabled: inAppPref && !isInAppOwnedByCaller(status),
      smsFeatureEnabled: smsFeatureEnabled(),
    });

    // ── In-app channel ────────────────────────────────────────────────────────
    if (channels.inApp) {
      await prisma.notification
        .create({
          data: {
            buyerId,
            type: plan.type,
            channel: "IN_APP",
            title: plan.title,
            body: plan.body,
            actionUrl: plan.actionUrl,
            metadata: {
              source: "acquisition-comms",
              dealId,
              dealStatus: status,
              actionRequired: plan.actionRequired,
            },
          },
        })
        .catch((err) => logger.error("[acq-comms] in-app notification failed:", err));
    }

    // ── SMS channel (opt-in, fully gated inside sendCrmSms) ────────────────────
    let smsOutcome: SmsOutcome = channels.sms ? "failed" : "disabled";
    if (channels.sms && plan.sms) {
      smsOutcome = await dispatchSms({
        buyer,
        smsBody: plan.sms,
        actionUrl: plan.actionUrl,
        idempotencyKey: key,
      });
    }

    // ── Record terminal outcome on the idempotency ledger ──────────────────────
    //
    // The THIRD fail-open of §8.2 defect (5), and the only one that stays best-effort
    // — deliberately, with the reason stated rather than an empty `catch`.
    //
    // The latch was CLAIMED above; this write only annotates it with the outcome. A
    // failure here cannot cause a duplicate send, because the claim already holds the
    // key. Refusing the send at this point would mean discarding a message that has
    // ALREADY gone out, which is strictly worse than an un-annotated ledger row.
    //
    // What changes is that it is no longer silent: an empty `catch` block left a
    // ledger entry stuck at its claimed state with nothing anywhere saying so.
    try {
      const { updateIdempotencyState } = await import("@/lib/jobs/idempotency");
      await updateIdempotencyState(guardSupabase, key, "completed", {
        dealId,
        dealStatus: status,
        inApp: channels.inApp,
        sms: smsOutcome,
      });
    } catch (err) {
      logger.error("[acq-comms] idempotency ledger annotation failed — the message WAS sent", {
        key,
        dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { status: "sent", inApp: channels.inApp, sms: smsOutcome };
  } catch (err) {
    // The whole seam is best-effort: never let a comms failure break a deal
    // state transition.
    logger.error("[acq-comms] emitDealStatusComms failed:", err);
    return { status: "skipped", inApp: false, sms: "failed" };
  }
}

/**
 * §28.3 #8 — an unguarded comms path gets an owner and a return path.
 *
 * Raised when the idempotency latch cannot be consulted at all. `COMMS_EXCEPTION` is
 * the §26 bucket; the code is the catalogued `COMMS_NO_DELIVERABLE_CHANNEL` sibling
 * for a guard fault, and the detail carries the key so the send can be re-driven by
 * hand once the guard is back.
 *
 * Never throws. This is the failure handler; a failure inside it must not replace the
 * original fault with a less useful one.
 */
async function raiseCommsGuardException(
  dealId: string,
  buyerId: string,
  key: string,
  detail: string,
): Promise<void> {
  try {
    const { raiseException } = await import("@/lib/services/operations/queue-item.service");
    await raiseException({
      code: "COMMS_GUARD_UNAVAILABLE",
      dealId,
      buyerId,
      detail: `${detail}. Idempotency key: ${key}. The message was NOT sent.`,
      idempotencyKey: `COMMS_GUARD_UNAVAILABLE:${key}`,
    });
  } catch (err) {
    logger.error("[acq-comms] could not raise the guard-unavailable exception", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Lazy service-role Supabase accessor for the idempotency guard. Returns null
// (rather than throwing) when Supabase env is not configured, so dev/test paths
// degrade to "no latch" instead of crashing the notification.
async function getGuardSupabase(): Promise<import("@supabase/supabase-js").SupabaseClient | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    return getServiceSupabase();
  } catch (err) {
    logger.error("[acq-comms] service supabase init failed:", err);
    return null;
  }
}

interface CrmContactRow {
  id: string;
  phone: string | null;
  consent_sms: boolean;
  do_not_contact: boolean;
}

interface DispatchSmsInput {
  buyer: {
    firstName: string | null;
    phone: string | null;
    state: string | null;
    zip: string | null;
    user: { email: string | null } | null;
  };
  smsBody: string;
  actionUrl: string;
  idempotencyKey: string;
}

// Resolves the buyer's CRM contact (the record that holds TCPA consent) and
// sends through the hardened `sendCrmSms` gate. Never throws.
async function dispatchSms(input: DispatchSmsInput): Promise<SmsOutcome> {
  try {
    const email = input.buyer.user?.email ?? null;
    const buyerPhone = input.buyer.phone ?? null;
    if (!email && !buyerPhone) return "no_contact";

    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const { sendCrmSms } = await import("@/lib/services/sms/crm-sms");
    const supabase = getServiceSupabase();

    // The CRM `contacts` row is the consent record of truth. Without it there is
    // no TCPA basis to text — fail safe.
    let contactRow: CrmContactRow | null = null;

    if (email) {
      const { data } = await supabase
        .from("contacts")
        .select("id, phone, consent_sms, do_not_contact")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      contactRow = (data as CrmContactRow | null) ?? null;
    }
    if (!contactRow) return "no_contact";

    const fullUrl = `${APP_URL}${input.actionUrl}`;
    const greeting = input.buyer.firstName ? `Hi ${input.buyer.firstName}, ` : "";
    const body = `${greeting}${input.smsBody} ${fullUrl}`;

    const res = await sendCrmSms({
      supabase,
      contact: {
        id: contactRow.id,
        phone: contactRow.phone ?? buyerPhone,
        consent_sms: contactRow.consent_sms,
        do_not_contact: contactRow.do_not_contact,
      },
      body,
      fromPool: "tollfree",
      state: input.buyer.state,
      zip: input.buyer.zip,
      idempotencyKey: input.idempotencyKey,
    });
    return res.status;
  } catch (err) {
    logger.error("[acq-comms] sms dispatch failed:", err);
    return "failed";
  }
}
