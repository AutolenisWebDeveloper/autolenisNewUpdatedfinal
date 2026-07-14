// In-memory conversation store for Twilio Voice calls, keyed by CallSid.
// Each call accumulates a short message history plus the structured vehicle
// request Zura collects over the phone. Entries auto-expire after 2 hours so a
// dropped call (no status callback) can never leak memory.
//
// TODO: Replace with Upstash Redis for multi-instance Vercel deployments —
// this Map is per server instance, so a call that lands on a different lambda
// between webhooks would start with empty history.

import type { BuyerLookupResult } from "@/lib/services/voice/buyer-lookup.service";

export interface VoiceMessage {
  role: "user" | "assistant";
  content: string;
}

export interface VehicleRequestDraft {
  firstName?: string;
  lastName?: string;
  email?: string;
  zip?: string;
  make?: string;
  model?: string;
  // Body style: SUV / Sedan / Truck / Van / Coupe.
  vehicleType?: string;
  yearMin?: string;
  yearMax?: string;
  budget?: string;
  // Purchase timeframe: ASAP / Within 7 days / Within 30 days / Flexible.
  timeline?: string;
  // Condition: new / used / either.
  newOrUsed?: string;
  // "yes" / "no".
  hasTradeIn?: string;
  // "cash" / "financing".
  financing?: string;
}

// Classified reason the caller phoned in. Drives how Zura responds and how the
// call is dispatched when it ends (vehicle pipeline vs. founder SMS alert).
export type CallReason =
  | "vehicle_request"
  | "question"
  | "status_check"
  | "message"
  | "dealer_inquiry"
  | "transfer_request"
  | "other";

// Structured details captured for non-vehicle calls (message, status check,
// dealer inquiry, transfer request, etc.). Surfaced to the founder via SMS.
export interface MessageDetails {
  callerName?: string;
  callerEmail?: string;
  // What the caller wants help with.
  reason?: string;
  bestCallbackTime?: string;
  // Dealer-inquiry specifics (callReason = "dealer_inquiry"): the dealership's
  // business name and its city/state, so the founder can qualify the partner
  // before calling back.
  dealership?: string;
  location?: string;
}

export interface VoiceConversation {
  history: VoiceMessage[];
  callerPhone: string;
  // The Twilio number the caller dialed (the "To" param). Used to tag the
  // BuyerOpportunity source as toll-free vs local for dual-number tracking.
  inboundNumber?: string;
  // Classified intent for this call. Undefined until the extractor runs.
  callReason?: CallReason;
  // Populated for non-vehicle call reasons (message / status_check / dealer /
  // transfer / question / other).
  messageDetails?: MessageDetails;
  // Zura Intelligence Phase 2 — returning-caller lookup result, resolved once
  // at call start (in /voice/incoming) and reused across turns so the Groq
  // prompt can reference the caller's existing request without re-querying.
  buyerContext?: BuyerLookupResult;
  vehicleRequest: VehicleRequestDraft | null;
  requestDispatched: boolean;
  // True once a non-vehicle call has fired the founder SMS alert, so it can
  // only fire once per call (mirrors requestDispatched for the vehicle path).
  founderAlertSent: boolean;
  // True once a minimum-viable lead (a name + caller phone) has triggered the
  // confirmation SMS + form-submitted job, so it can only fire once per call.
  partialLeadDispatched: boolean;
  lastActivity: number;
}

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const store = new Map<string, VoiceConversation>();

// Drop entries that have gone quiet for longer than the TTL. Runs
// opportunistically on every access — there is no reliable background timer in
// a serverless runtime.
function sweepExpired(now: number): void {
  for (const [callSid, conv] of store) {
    if (now - conv.lastActivity > TTL_MS) store.delete(callSid);
  }
}

export function getConversation(callSid: string): VoiceConversation {
  const now = Date.now();
  sweepExpired(now);

  let conv = store.get(callSid);
  if (!conv) {
    conv = {
      history: [],
      callerPhone: "",
      vehicleRequest: null,
      requestDispatched: false,
      founderAlertSent: false,
      partialLeadDispatched: false,
      lastActivity: now,
    };
    store.set(callSid, conv);
  }
  return conv;
}

export function updateConversation(
  callSid: string,
  updates: Partial<VoiceConversation>,
): VoiceConversation {
  const now = Date.now();
  sweepExpired(now);

  const conv = getConversation(callSid);
  const next: VoiceConversation = {
    ...conv,
    ...updates,
    // Merge the vehicle-request draft field-by-field so a partial update never
    // wipes fields collected on an earlier turn.
    vehicleRequest:
      updates.vehicleRequest === undefined
        ? conv.vehicleRequest
        : updates.vehicleRequest === null
          ? null
          : { ...(conv.vehicleRequest ?? {}), ...updates.vehicleRequest },
    // Merge messageDetails field-by-field so a partial update never wipes
    // details captured on an earlier turn.
    messageDetails:
      updates.messageDetails === undefined
        ? conv.messageDetails
        : { ...(conv.messageDetails ?? {}), ...updates.messageDetails },
    lastActivity: now,
  };
  store.set(callSid, next);
  return next;
}

export function clearConversation(callSid: string): void {
  store.delete(callSid);
}
