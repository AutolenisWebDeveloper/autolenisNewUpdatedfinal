// lib/services/buyer/co-buyer.service.ts — Stage 4 co-buyer capture (§4c, §6.2; Phase 4).
//
// A co-buyer changes two things a deal cannot be completed without knowing: WHO SIGNS, and
// whose credit the financing rests on. §5a therefore makes "co-buyer and trade elections
// recorded" a precondition of taking the deposit, and `deposit-eligibility.ts` fails
// ELECTIONS_REQUIRED until this service has written an answer.
//
// THREE RULES, EACH OF WHICH IS THE REASON THIS IS A SERVICE AND NOT A FORM HANDLER.
//
//   1. NO SSN, EVER. `co_buyers` has no column for one and this service will not accept one:
//      an identity number for a THIRD PARTY, collected by a buyer on their behalf, through a
//      form we control, is the highest-consequence field on the platform and it is not needed
//      at Stage 4. The co-buyer supplies it themselves, to the lender, at financing.
//      `__tests__/co-buyer-no-ssn.test.ts` is the build-failing rule.
//
//   2. CONSENT BEFORE PII. The co-buyer is not our user and has not agreed to anything. We
//      store their name and contact details only when the buyer confirms they have permission
//      to share them, and we record WHEN and against WHICH WORDING. Without that the write is
//      refused — not silently downgraded to a partial record.
//
//   3. "NO" IS AN ANSWER. Electing not to have a co-buyer is a complete, recorded election
//      that clears the gate. It is not the absence of one. `vehicle_requests.co_buyer_elected`
//      is nullable with no default precisely so the two can be told apart.

import { prisma } from "@/lib/prisma";
import { OPEN_REQUEST_STATUSES } from "@/lib/services/vehicle-request/open-request.service";

/**
 * The wording the buyer confirms. Versioned like the deposit disclosures: an acceptance of
 * different words is not an acceptance of these, and a stored version is what makes that
 * checkable later.
 */
export const CO_BUYER_SHARE_CONSENT_VERSION = "2026-09-10";

export const CO_BUYER_SHARE_CONSENT_TEXT =
  "I have this person's permission to share their name and contact details with AutoLenis and " +
  "with the dealerships competing for my business, and they know they may be asked to sign.";

/** Roles a co-buyer can hold. Free text in the column; constrained here so the UI and the API agree. */
export const CO_BUYER_ROLES = ["SPOUSE", "PARTNER", "PARENT", "CHILD", "RELATIVE", "FRIEND", "CO_SIGNER", "OTHER"] as const;
export type CoBuyerRole = (typeof CO_BUYER_ROLES)[number];

export interface CoBuyerInput {
  legalFirstName: string;
  legalLastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  role?: CoBuyerRole | null;
  /** §6.2: whether this person must sign the contract. Drives e-sign envelope recipients. */
  isRequiredSigner: boolean;
  /** Rule 2. Must be true for any PII to be stored. */
  shareConsent: boolean;
}

export type CoBuyerRefusalCode =
  | "REQUEST_NOT_FOUND"
  | "REQUEST_CLOSED"
  | "CONSENT_REQUIRED"
  | "NAME_REQUIRED"
  | "CONTACT_REQUIRED"
  | "PROHIBITED_FIELD";

export const CO_BUYER_REFUSALS: Record<CoBuyerRefusalCode, string> = {
  REQUEST_NOT_FOUND: "We could not find that vehicle request.",
  REQUEST_CLOSED: "This request is closed, so its co-buyer can no longer be changed.",
  CONSENT_REQUIRED:
    "Confirm you have this person's permission to share their details before we save them.",
  NAME_REQUIRED: "We need the co-buyer's legal first and last name, as it appears on their ID.",
  CONTACT_REQUIRED: "We need an email address or a phone number so the co-buyer can be reached to sign.",
  PROHIBITED_FIELD:
    "We do not collect a co-buyer's Social Security number. They will provide it to the lender directly.",
};

export interface CoBuyerRecord {
  id: string;
  legalFirstName: string | null;
  legalLastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  role: string | null;
  isRequiredSigner: boolean;
  shareConsentAt: Date | null;
  shareConsentVersion: string | null;
}

export type CoBuyerResult =
  | { ok: true; elected: boolean; coBuyer: CoBuyerRecord | null }
  | { ok: false; code: CoBuyerRefusalCode; message: string };

/**
 * Rule 1, enforced at the boundary as well as in the schema.
 *
 * A JSON body is not a typed object: a client can send `ssn` and TypeScript will not see it.
 * The route parses with a strict schema, and this is the second line — a key that looks like
 * an identity number is REFUSED rather than dropped, because silently discarding it would let
 * a caller believe it had been stored and stop looking for where.
 */
const PROHIBITED_KEY = /^(ssn|social|social_?security|taxId|tax_?id|itin|dob|dateOfBirth|date_of_birth|driversLicense|drivers_?license|dlNumber)$/i;

export function findProhibitedField(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (PROHIBITED_KEY.test(key)) return key;
  }
  return null;
}

async function loadOpenRequest(buyerId: string, requestId: string) {
  return prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId },
    select: { id: true, status: true },
  });
}

function toRecord(row: Record<string, unknown>): CoBuyerRecord {
  return {
    id: row.id as string,
    legalFirstName: (row.legalFirstName as string | null) ?? null,
    legalLastName: (row.legalLastName as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    zip: (row.zip as string | null) ?? null,
    role: (row.role as string | null) ?? null,
    isRequiredSigner: Boolean(row.isRequiredSigner),
    shareConsentAt: (row.shareConsentAt as Date | null) ?? null,
    shareConsentVersion: (row.shareConsentVersion as string | null) ?? null,
  };
}

const CO_BUYER_SELECT = {
  id: true, legalFirstName: true, legalLastName: true, email: true, phone: true,
  city: true, state: true, zip: true, role: true, isRequiredSigner: true,
  shareConsentAt: true, shareConsentVersion: true,
} as const;

/** The current co-buyer on a request, if any. */
export async function getCoBuyer(buyerId: string, requestId: string): Promise<CoBuyerRecord | null> {
  const row = await prisma.coBuyer.findFirst({
    where: { buyerId, vehicleRequestId: requestId },
    select: CO_BUYER_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return row ? toRecord(row as Record<string, unknown>) : null;
}

/**
 * Record the election, and the co-buyer when there is one.
 *
 * Electing NO removes any co-buyer previously captured — leaving the row while recording "no"
 * would keep a third party's contact details we have just been told we should not hold, and
 * would put a required signer on an envelope for a deal that has none.
 *
 * Editing is the same call: the row is upserted, so a corrected surname or a changed
 * required-signer flag re-uses the existing record rather than accumulating a second one.
 */
export async function recordCoBuyerElection(
  buyerId: string,
  requestId: string,
  elected: boolean,
  input?: CoBuyerInput,
  rawBody?: unknown,
  now: Date = new Date(),
): Promise<CoBuyerResult> {
  const refuse = (code: CoBuyerRefusalCode): CoBuyerResult => ({ ok: false, code, message: CO_BUYER_REFUSALS[code] });

  const prohibited = findProhibitedField(rawBody);
  if (prohibited) return refuse("PROHIBITED_FIELD");

  const request = await loadOpenRequest(buyerId, requestId);
  if (!request) return refuse("REQUEST_NOT_FOUND");
  if (!OPEN_REQUEST_STATUSES.includes(request.status as never)) return refuse("REQUEST_CLOSED");

  if (!elected) {
    await prisma.$transaction([
      prisma.coBuyer.deleteMany({ where: { buyerId, vehicleRequestId: requestId } }),
      prisma.vehicleRequest.update({
        where: { id: requestId },
        data: { coBuyerElected: false, updatedAt: now },
        select: { id: true },
      }),
    ]);
    return { ok: true, elected: false, coBuyer: null };
  }

  if (!input) return refuse("NAME_REQUIRED");
  const first = (input.legalFirstName ?? "").trim();
  const last = (input.legalLastName ?? "").trim();
  if (!first || !last) return refuse("NAME_REQUIRED");

  const email = (input.email ?? "").trim() || null;
  const phone = (input.phone ?? "").trim() || null;
  // A co-buyer who cannot be reached cannot sign, and an envelope addressed to nobody fails
  // at the e-sign step — after the money has moved.
  if (!email && !phone) return refuse("CONTACT_REQUIRED");

  if (input.shareConsent !== true) return refuse("CONSENT_REQUIRED");

  const existing = await prisma.coBuyer.findFirst({
    where: { buyerId, vehicleRequestId: requestId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    legalFirstName: first,
    legalLastName: last,
    email,
    phone,
    address: (input.address ?? "").trim() || null,
    city: (input.city ?? "").trim() || null,
    state: (input.state ?? "").trim() || null,
    zip: (input.zip ?? "").trim() || null,
    role: input.role ?? null,
    isRequiredSigner: input.isRequiredSigner === true,
    requestedByPrimaryAt: now,
    shareConsentAt: now,
    shareConsentVersion: CO_BUYER_SHARE_CONSENT_VERSION,
    updatedAt: now,
  };

  const row = existing
    ? await prisma.coBuyer.update({ where: { id: existing.id }, data, select: CO_BUYER_SELECT })
    : await prisma.coBuyer.create({
        data: { id: crypto.randomUUID(), buyerId, vehicleRequestId: requestId, createdAt: now, ...data },
        select: CO_BUYER_SELECT,
      });

  await prisma.vehicleRequest.update({
    where: { id: requestId },
    data: { coBuyerElected: true, updatedAt: now },
    select: { id: true },
  });

  return { ok: true, elected: true, coBuyer: toRecord(row as Record<string, unknown>) };
}

/**
 * Anonymise a buyer's co-buyers instead of deleting them.
 *
 * Used by the account-deletion SOFT path. The buyer row is kept there because a Deal, Deposit
 * or Auction still points at it; `deals.co_buyer_id` and `e_sign_envelopes.co_buyer_id` point
 * at these rows the same way, so deleting one would sever a legally-retained deal's record of
 * who signed it. The third party's PII goes; the link and the signer flag stay.
 */
export async function anonymizeCoBuyersForBuyer(buyerId: string, now: Date = new Date()): Promise<number> {
  const { count } = await prisma.coBuyer.updateMany({
    where: { buyerId },
    data: {
      legalFirstName: "Deleted",
      legalLastName: "Co-Buyer",
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      updatedAt: now,
    },
  });
  return count;
}
