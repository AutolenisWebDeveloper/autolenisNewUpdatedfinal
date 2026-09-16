// lib/services/pickup/qr.service.ts — rendering only. The credential itself is minted by
// `release-token.service.ts`; this file knows how to draw one and nothing else.
//
// WHAT WAS HERE BEFORE, AND WHY NEITHER EXPORT SURVIVED:
//
//   generatePickupQr(dealId, pickupId)  — built a JSON payload whose `nonce` was
//     `Math.random().toString(36).slice(2)`, stored the payload verbatim in `pickups.qr_code_data`
//     and the rendered PNG in `pickups.qr_code_image`. `Math.random` is not a CSPRNG; the payload
//     was the credential; the PNG decoded back to it. Every part of that is what Phase 9 retires.
//
//   validateQrPayload(qrData, dealId)   — parsed the payload and returned true when `type` and
//     `dealId` matched. It had ZERO callers (verified by grep across `app/`, `lib/` and
//     `components/` on 2026-09-16) and could not have been a control if it had any: both fields it
//     checked are chosen by whoever writes the QR. The owner authorised its deletion.
//
// The library stays local (`qrcode`, D7 — never an external QR API): sending a release credential
// to a third-party image service to be drawn would undo the rest of this change.

import QRCode from "qrcode";

/**
 * Draw a raw release token as a scannable data-URL PNG.
 *
 * The QR encodes the RAW TOKEN ALONE — no deal id, no pickup id, no JSON wrapper. The old payload
 * carried all three, which told anyone who photographed a code which deal it belonged to before
 * they ever presented it. The token resolves to its appointment server-side; the code itself needs
 * to say nothing.
 *
 * The result is returned to exactly one caller and is NEVER persisted. A stored render is a stored
 * credential regardless of which column it sits in.
 */
export async function renderReleaseQr(rawToken: string): Promise<string> {
  return QRCode.toDataURL(rawToken, { width: 300 });
}
