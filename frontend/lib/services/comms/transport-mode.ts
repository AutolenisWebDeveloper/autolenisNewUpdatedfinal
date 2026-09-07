// lib/services/comms/transport-mode.ts
//
// COMMS_TRANSPORT — the transport boundary, and the single place that decides
// whether a message actually leaves the building.
//
// §12.3 step 6 of the preview-isolation preflight requires that in a preview run
// "every transactional email/SMS lands in `comms_outbox` with
// `provider_id='captured'`" and no provider is called. That is a property of the
// TRANSPORT, not of the caller: a mode that each sender had to remember to check
// would be one forgotten call away from a real email to a real buyer from a test.
//
// Two modes, and the default is the safe reading of an unset variable in reverse:
//   • `live`    — the default. Providers are called. This is production.
//   • `capture` — set explicitly by a preview or E2E environment. Nothing is sent;
//                 the adapter returns the sentinel provider id `captured`, which
//                 the outbox writes to `provider_id`, so a test can assert that a
//                 message was rendered, gated and dispatched without one being
//                 delivered.
//
// `live` is the default deliberately. An environment that fails to set the
// variable sends mail, which is the status quo; a default of `capture` would mean
// one missing variable in production silently swallows every buyer communication.
// The preflight asserts `capture` positively rather than relying on a default —
// see §12.3, which also requires `RESEND_API_KEY` and `TWILIO_AUTH_TOKEN` to be
// unset, so capture is a second control on top of an absent credential, not the
// only one.

export type CommsTransportMode = "live" | "capture";

/** The sentinel written to `comms_outbox.provider_id` for a captured message. */
export const CAPTURED_PROVIDER_ID = "captured";

/**
 * Read at call time, never cached: a test that sets the variable between cases
 * must see the change, and the cost is one `process.env` read per send.
 */
export function commsTransportMode(): CommsTransportMode {
  return process.env.COMMS_TRANSPORT === "capture" ? "capture" : "live";
}

/** True when no provider may be contacted. */
export function isCaptureTransport(): boolean {
  return commsTransportMode() === "capture";
}
