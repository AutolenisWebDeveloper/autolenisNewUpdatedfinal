// In-memory conversation store for Twilio Voice calls, keyed by CallSid.
// Each call accumulates a short message history plus the structured vehicle
// request Zura collects over the phone. Entries auto-expire after 2 hours so a
// dropped call (no status callback) can never leak memory.
//
// TODO: Replace with Upstash Redis for multi-instance Vercel deployments —
// this Map is per server instance, so a call that lands on a different lambda
// between webhooks would start with empty history.

export interface VoiceMessage {
  role: "user" | "assistant";
  content: string;
}

export interface VehicleRequestDraft {
  firstName?: string;
  lastName?: string;
  email?: string;
  make?: string;
  model?: string;
  budget?: string;
  timeline?: string;
  newOrUsed?: string;
}

export interface VoiceConversation {
  history: VoiceMessage[];
  callerPhone: string;
  vehicleRequest: VehicleRequestDraft | null;
  requestDispatched: boolean;
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
    lastActivity: now,
  };
  store.set(callSid, next);
  return next;
}

export function clearConversation(callSid: string): void {
  store.delete(callSid);
}
