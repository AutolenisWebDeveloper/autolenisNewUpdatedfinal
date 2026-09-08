// lib/services/acquisition/intake-consent.ts
//
// §5 rule 4, and §13-D46.
//
//   "Consent is captured and timestamped. Email consent, SMS consent, and terms
//    acceptance are stored with version and timestamp. No marketing or
//    transactional SMS is sent without a stored consent record."
//
// §13-D46 records what that looks like today, and it is three separate defects:
// the onboarding wizard gates a button on an SMS checkbox it never transmits; the
// SEO landing form HARD-CODES `consent_sms: true` with no checkbox at all
// (`components/seo/landing/VehicleRequestForm.tsx:124-125`), which is a TCPA
// defect rather than a gap; and Google-OAuth signups store a NULL terms version.
// Across all of them, `consentVersion` appears only in schema.prisma — no
// application code has ever written one.
//
// The remedy, proposed in D46 and implemented here: ONE CONSENT RECORD PER SURFACE,
// carrying the version, a hash of the exact text shown, the surface, the IP and the
// timestamp — and no pre-checked boxes anywhere.
//
// WHY A TEXT HASH AND NOT THE TEXT. A consent record has to answer "what exactly
// did this person agree to?" years later, and copying the paragraph onto every row
// is both large and easy to drift from what was rendered. The hash pins the exact
// string; `CONSENT_TEXTS` below holds the versioned originals, and the pair is
// verifiable — the test recomputes every hash from the text and fails if one
// diverges.
//
// WHY A VERSION AND NOT A DATE. "The terms as of the 4th of March" requires knowing
// what changed and when. A version is what a compliance reviewer can hold.
//
// Run: pnpm test:intake

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { IpUnavailableReason } from "./intake-attribution";

type Db = typeof prisma | Prisma.TransactionClient;

/** The versioned consent texts. A new version is a new entry; entries are never edited. */
export const CONSENT_TEXTS = {
  "terms-2026-01": "I agree to the AutoLenis Terms of Service and Privacy Policy.",
  "email-2026-01": "Email me about my vehicle request, my offers, and my deal.",
  "sms-2026-01":
    "Text me about my vehicle request and my deal at the number I provided. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
} as const;

export type ConsentVersion = keyof typeof CONSENT_TEXTS;

/** Which channel a consent record covers. */
export type ConsentChannel = "terms" | "email" | "sms";

/** The current version for each channel. Bumping one is a deliberate, reviewable edit. */
export const CURRENT_CONSENT_VERSION: Readonly<Record<ConsentChannel, ConsentVersion>> = {
  terms: "terms-2026-01",
  email: "email-2026-01",
  sms: "sms-2026-01",
};

/** SHA-256 of the exact text shown, hex. */
export function consentTextHash(version: ConsentVersion): string {
  return createHash("sha256").update(CONSENT_TEXTS[version], "utf8").digest("hex");
}

/**
 * What a surface captured.
 *
 * Every field is required except the IP pair, because a consent record with an
 * unknown surface or an unknown version cannot answer the question it exists to
 * answer. `granted: false` is recorded too — declining is a fact, and "no record"
 * and "declined" must not look the same to a send-time consent check.
 */
export interface ConsentCapture {
  /** The form the visitor was looking at. Free text, but stable per surface. */
  surface: string;
  /** Which channels the visitor affirmatively ticked. Never pre-checked. */
  granted: Partial<Record<ConsentChannel, boolean>>;
  ip?: string | null;
  ipUnavailableReason?: IpUnavailableReason | null;
}

/** The columns a consent capture writes onto a request or a lead. */
export interface ConsentColumns {
  consentVersion: string | null;
  consentTextHash: string | null;
  consentSurface: string | null;
  consentIp: string | null;
  consentIpUnavailableReason: IpUnavailableReason | null;
  consentSms: boolean | null;
  consentAt: Date | null;
}

/**
 * Turn a capture into columns.
 *
 * The version and hash written are the TERMS ones: terms acceptance is the record
 * that governs the transaction, and the per-channel grants ride alongside it. A
 * capture with no terms acceptance writes no version — an unversioned consent is
 * exactly what §13-D46 flags on the OAuth path, and manufacturing one here would
 * hide it rather than fix it.
 */
export function consentColumns(capture: ConsentCapture | null | undefined): ConsentColumns {
  if (!capture || !capture.granted.terms) {
    return {
      consentVersion: null,
      consentTextHash: null,
      consentSurface: capture?.surface ?? null,
      consentIp: null,
      consentIpUnavailableReason: null,
      consentSms: capture ? Boolean(capture.granted.sms) : null,
      consentAt: capture ? new Date() : null,
    };
  }
  const version = CURRENT_CONSENT_VERSION.terms;
  const ip = capture.ip?.trim() || null;
  return {
    consentVersion: version,
    consentTextHash: consentTextHash(version),
    consentSurface: capture.surface,
    consentIp: ip,
    // Same rule as `ip_address`: an address or a reason, never a sentinel. The
    // Phase 1 migration CHECKs that the two are mutually exclusive.
    consentIpUnavailableReason: ip ? null : (capture.ipUnavailableReason ?? "UNKNOWN"),
    consentSms: Boolean(capture.granted.sms),
    consentAt: new Date(),
  };
}

/**
 * Has this buyer given SMS consent, from a record rather than from a flag?
 *
 * §5 rule 4: "No marketing or transactional SMS is sent without a stored consent
 * record." The dispatcher calls this before an SMS leaves; absence is a refusal,
 * not a default.
 */
export async function hasSmsConsent(buyerId: string, db: Db = prisma): Promise<boolean> {
  // The SMS grant lives on `buyer_opportunities.consent_sms` — `vehicle_requests`
  // carries the versioned TERMS record (version, text hash, surface, IP) but no
  // per-channel boolean. Both halves are required: a grant with no versioned terms
  // record behind it is the unversioned consent §13-D46 flags, and it does not
  // count.
  const lead = await db.buyerOpportunity.findFirst({
    where: { buyerId, consentSms: true, consentVersion: { not: null } },
    select: { id: true },
  });
  return lead !== null;
}

/** Record a consent capture against an existing request. Used by surfaces that capture later. */
export async function recordConsent(
  vehicleRequestId: string,
  capture: ConsentCapture,
  db: Db = prisma
): Promise<void> {
  const cols = consentColumns(capture);
  await db.vehicleRequest.update({
    where: { id: vehicleRequestId },
    data: {
      consentVersion: cols.consentVersion,
      consentTextHash: cols.consentTextHash,
      consentSurface: cols.consentSurface,
      consentIp: cols.consentIp,
      consentIpUnavailableReason: cols.consentIpUnavailableReason,
    },
  });
}
