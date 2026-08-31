// Manual call logging — the operator's half of the transaction.
//
// The click-to-call link and the log form are the only outreach action that
// ships ENABLED, so the rules that govern them belong somewhere they can be
// tested rather than inside a component this repo has no harness to render.
//
// Nothing here talks to the network. It converts what an operator typed into
// exactly the shape /api/admin/dealer-outreach/log-call accepts, or refuses it
// with a message that names the field.

import { normalizePhone } from "@/lib/utils/phone";
import { isValidUsPhone } from "@/lib/services/sms/twilio.service";
import { CALL_DISPOSITIONS, type CallDisposition } from "./dealer-call-log.service";

/**
 * A dialable `tel:` URI, or null.
 *
 * Null rather than a best-effort href on purpose: a link that cannot dial still
 * looks actionable, so the operator taps it and nothing happens. Rendering no
 * link at all is honest about a number we do not have.
 */
export function telHref(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone ?? "");
  return isValidUsPhone(normalized) ? `tel:${normalized}` : null;
}

/** Every disposition the service accepts, said the way an operator would say
 *  it. A test asserts this map and CALL_DISPOSITIONS stay in step — a dropdown
 *  offering a value the service rejects is a silent divergence. */
export const DISPOSITION_LABELS: Record<CallDisposition, string> = {
  CONNECTED: "Spoke with someone",
  VOICEMAIL: "Left a voicemail",
  NO_ANSWER: "No answer",
  BUSY: "Line busy",
  WRONG_NUMBER: "Wrong number",
  GATEKEEPER: "Blocked by a gatekeeper",
  NOT_INTERESTED: "Not interested",
  CALLBACK_REQUESTED: "Asked us to call back",
};

export interface CallFormValues {
  prospectId: string;
  disposition: string;
  minutes: string;
  seconds: string;
  notes: string;
}

export interface CallLogRequest {
  prospectId: string;
  disposition: CallDisposition;
  durationSeconds: number;
  notes?: string;
}

export type CallFormResult =
  | { ok: true; value: CallLogRequest }
  | { ok: false; field: keyof CallFormValues; message: string };

/** An empty box is zero, anything else must be a real non-negative integer. */
function parseUnit(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Validate here rather than letting the API do it. The service refuses a
 * non-finite or negative duration, but a 400 arriving after the operator moved
 * on is a worse experience than a field that says what is wrong while they are
 * still looking at it. The server still enforces all of this — this is the
 * courtesy layer, not the control.
 */
export function buildCallLogRequest(form: CallFormValues): CallFormResult {
  if (!form.prospectId) {
    return { ok: false, field: "prospectId", message: "No prospect selected." };
  }
  if (!(CALL_DISPOSITIONS as readonly string[]).includes(form.disposition)) {
    return { ok: false, field: "disposition", message: "Choose how the call went." };
  }

  const minutes = parseUnit(form.minutes);
  if (minutes === null) {
    return { ok: false, field: "minutes", message: "Minutes must be a whole number of 0 or more." };
  }
  const seconds = parseUnit(form.seconds);
  if (seconds === null) {
    return { ok: false, field: "seconds", message: "Seconds must be a whole number of 0 or more." };
  }

  const notes = form.notes.trim();
  return {
    ok: true,
    value: {
      prospectId: form.prospectId,
      disposition: form.disposition as CallDisposition,
      durationSeconds: minutes * 60 + seconds,
      notes: notes || undefined,
    },
  };
}
