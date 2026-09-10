// lib/services/trade-in/trade-in.service.ts — System 18

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { TradeInStatus, TradeInCondition } from "@prisma/client";

export async function submitTradeIn(buyerId: string, data: {
  vin?: string; year: number; make: string; model: string; trim?: string;
  mileage?: number; condition: string; loanStatus?: string; loanBalanceCents?: number; notes?: string;
}) {
  const submission = await prisma.tradeInSubmission.create({
    data: {
      buyerId,
      vin: data.vin,
      year: data.year,
      make: data.make,
      model: data.model,
      trim: data.trim,
      mileage: data.mileage,
      condition: data.condition as TradeInCondition,
      loanStatus: data.loanStatus,
      loanBalanceCents: data.loanBalanceCents,
      notes: data.notes,
      status: TradeInStatus.SUBMITTED,
    },
  });

  // CRM contact-plane sync (additive, non-blocking) — append AFTER the trade-in
  // row is committed so a CRM hiccup can never affect the submission. The form
  // collects NO email/SMS consent, so we pass none (consent merges upward in the
  // upsert and is never defaulted true). ZIP/state ride the event payload to feed
  // the downstream SMS recipient-timezone resolver.
  try {
    const buyer = await prisma.buyer.findUnique({
      where: { id: buyerId },
      include: { user: true },
    });
    const email = buyer?.user.email ?? null;
    if (buyer && email) {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const { emitDomainEvent } = await import("@/lib/events/emit");
      const supabase = getServiceSupabase();

      const contact = await ContactService.upsertContact(supabase, {
        email,
        phone: buyer.phone ?? null,
        firstName: buyer.firstName ?? undefined,
        lastName: buyer.lastName ?? undefined,
        source: "trade_in",
      });
      await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyer.id);

      await emitDomainEvent("trade_in_submitted", {
        domainEntityId: submission.id,
        supabase,
        contact: {
          email,
          phone: buyer.phone ?? null,
          firstName: buyer.firstName ?? undefined,
          lastName: buyer.lastName ?? undefined,
          source: "trade_in",
        },
        data: {
          trade_in_id: submission.id,
          buyer_id: buyer.id,
          year: submission.year,
          make: submission.make,
          model: submission.model,
          zip: buyer.zip ?? null,
          state: buyer.state ?? null,
        },
      });
    }
  } catch (err) {
    logger.error("[trade-in] CRM emit failed:", err);
  }

  return submission;
}

export async function getBuyerTradeIns(buyerId: string) {
  return prisma.tradeInSubmission.findMany({ where: { buyerId }, orderBy: { createdAt: "desc" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4 — THE TRADE PACKET (§4c, §6.2; Phase 4)
//
// `submitTradeIn` above is the standalone, pre-account trade tool: it creates a submission
// against a BUYER and nothing else. The packet below is the Stage 4 half — the same table,
// attached to a VEHICLE REQUEST, carrying the §4c fields dealers price against, and gated by
// §5a's "co-buyer and trade elections recorded". They share `trade_in_submissions` on purpose:
// a second table would mean two answers to "does this buyer have a trade".
//
// WHY AN EDIT PATH IS PART OF THE FEATURE, NOT A FOLLOW-UP. A trade packet is entered before
// the buyer has looked up their payoff, found the second key, or checked whether the title is
// in hand. Every one of those changes the allowance. A capture-once form produces a packet
// that is wrong by the time a dealer reads it, and a buyer who cannot correct it will either
// abandon the request or tell the dealer something different from what we published — which is
// the discrepancy Contract Shield exists to catch, manufactured by our own form.
//
// THE APPRAISAL DISCLAIMER IS NOT DECORATION. Every figure here is buyer-stated and unverified.
// A dealer's allowance follows a physical inspection and can differ in either direction. The
// disclaimer is exported so the buyer surface, the dealer packet and the tests all render the
// SAME words — a promise made in one place and softened in another is worse than either.
// ─────────────────────────────────────────────────────────────────────────────

import { OPEN_REQUEST_STATUSES } from "@/lib/services/vehicle-request/open-request.service";

export const TRADE_APPRAISAL_DISCLAIMER =
  "This is an estimate based on what you have told us. It is not an offer. Any dealer allowance " +
  "follows a physical inspection of the vehicle and its title, and can be higher or lower.";

export const TRADE_PACKET_DISCLAIMER_VERSION = "2026-09-10";

export interface TradePacketInput {
  vin?: string | null;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  mileage?: number | null;
  condition: string;
  /** OWNED_OUTRIGHT | FINANCED | LEASED — free text in the column, named here so surfaces agree. */
  loanStatus?: string | null;
  loanBalanceCents?: number | null;
  lienholderName?: string | null;
  payoffGoodThroughDate?: Date | null;
  titleInHand?: boolean | null;
  titleState?: string | null;
  hasSecondKey?: boolean | null;
  photoUrls?: string[];
  notes?: string | null;
  /** §6.2: the buyer confirms these details may be shown to competing dealers. */
  shareConsent: boolean;
}

export type TradeRefusalCode =
  | "REQUEST_NOT_FOUND"
  | "REQUEST_CLOSED"
  | "CONSENT_REQUIRED"
  | "VEHICLE_REQUIRED"
  | "PAYOFF_REQUIRED";

export const TRADE_REFUSALS: Record<TradeRefusalCode, string> = {
  REQUEST_NOT_FOUND: "We could not find that vehicle request.",
  REQUEST_CLOSED: "This request is closed, so its trade-in can no longer be changed.",
  CONSENT_REQUIRED: "Confirm your trade details can be shown to competing dealers before we save them.",
  VEHICLE_REQUIRED: "We need the year, make and model of the vehicle you are trading in.",
  PAYOFF_REQUIRED:
    "Tell us roughly what is still owed on the vehicle. Dealers price a financed trade against the payoff, " +
    "and a missing figure gets guessed at — usually not in your favour.",
};

export interface TradePacketRecord {
  id: string;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  mileage: number | null;
  condition: string;
  loanStatus: string | null;
  loanBalanceCents: number | null;
  lienholderName: string | null;
  titleInHand: boolean | null;
  hasSecondKey: boolean | null;
  photoUrls: string[];
  shareConsentAt: Date | null;
  /** Always present. A packet rendered without it is a quote we cannot stand behind. */
  disclaimer: string;
}

export type TradePacketResult =
  | { ok: true; elected: boolean; packet: TradePacketRecord | null }
  | { ok: false; code: TradeRefusalCode; message: string };

const PACKET_SELECT = {
  id: true, vin: true, year: true, make: true, model: true, trim: true, mileage: true,
  condition: true, loanStatus: true, loanBalanceCents: true, lienholderName: true,
  titleInHand: true, hasSecondKey: true, photoUrls: true, shareConsentAt: true,
} as const;

function toPacket(row: Record<string, unknown>): TradePacketRecord {
  return {
    id: row.id as string,
    vin: (row.vin as string | null) ?? null,
    year: row.year as number,
    make: row.make as string,
    model: row.model as string,
    trim: (row.trim as string | null) ?? null,
    mileage: (row.mileage as number | null) ?? null,
    condition: String(row.condition),
    loanStatus: (row.loanStatus as string | null) ?? null,
    loanBalanceCents: (row.loanBalanceCents as number | null) ?? null,
    lienholderName: (row.lienholderName as string | null) ?? null,
    titleInHand: (row.titleInHand as boolean | null) ?? null,
    hasSecondKey: (row.hasSecondKey as boolean | null) ?? null,
    photoUrls: (row.photoUrls as string[] | undefined) ?? [],
    shareConsentAt: (row.shareConsentAt as Date | null) ?? null,
    disclaimer: TRADE_APPRAISAL_DISCLAIMER,
  };
}

/** The packet attached to a request, if any. */
export async function getTradePacket(buyerId: string, requestId: string): Promise<TradePacketRecord | null> {
  const row = await prisma.tradeInSubmission.findFirst({
    where: { buyerId, vehicleRequestId: requestId },
    select: PACKET_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return row ? toPacket(row as Record<string, unknown>) : null;
}

/**
 * Record the trade election, and the packet when there is one. This is BOTH the create and
 * the edit path: the submission is upserted against the request, so a corrected payoff or a
 * newly-found second key updates the packet dealers read rather than creating a second one.
 *
 * Electing NO does NOT delete an existing submission — it detaches it from the request and
 * leaves the standalone record. A buyer who changes their mind has not asked us to forget the
 * car they told us about, and the standalone trade tool's rows live in the same table.
 */
export async function recordTradeElection(
  buyerId: string,
  requestId: string,
  elected: boolean,
  input?: TradePacketInput,
  now: Date = new Date(),
): Promise<TradePacketResult> {
  const refuse = (code: TradeRefusalCode): TradePacketResult => ({ ok: false, code, message: TRADE_REFUSALS[code] });

  const request = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId },
    select: { id: true, status: true },
  });
  if (!request) return refuse("REQUEST_NOT_FOUND");
  if (!OPEN_REQUEST_STATUSES.includes(request.status as never)) return refuse("REQUEST_CLOSED");

  if (!elected) {
    await prisma.$transaction([
      prisma.tradeInSubmission.updateMany({
        where: { buyerId, vehicleRequestId: requestId },
        data: { vehicleRequestId: null },
      }),
      prisma.vehicleRequest.update({
        where: { id: requestId },
        data: { tradeElected: false, updatedAt: now },
        select: { id: true },
      }),
    ]);
    await mirrorTradeToFinancing(requestId, false);
    return { ok: true, elected: false, packet: null };
  }

  if (!input) return refuse("VEHICLE_REQUIRED");
  const make = (input.make ?? "").trim();
  const model = (input.model ?? "").trim();
  if (!input.year || !make || !model) return refuse("VEHICLE_REQUIRED");
  if (input.shareConsent !== true) return refuse("CONSENT_REQUIRED");
  // A financed or leased trade with no payoff is the single most common way a trade allowance
  // turns out to be worth nothing at the desk.
  const financed = input.loanStatus === "FINANCED" || input.loanStatus === "LEASED";
  if (financed && (input.loanBalanceCents == null || input.loanBalanceCents < 0)) {
    return refuse("PAYOFF_REQUIRED");
  }

  const existing = await prisma.tradeInSubmission.findFirst({
    where: { buyerId, vehicleRequestId: requestId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    vin: (input.vin ?? "").trim() || null,
    year: input.year,
    make,
    model,
    trim: (input.trim ?? "").trim() || null,
    mileage: input.mileage ?? null,
    condition: input.condition as TradeInCondition,
    loanStatus: input.loanStatus ?? null,
    loanBalanceCents: input.loanBalanceCents ?? null,
    lienholderName: (input.lienholderName ?? "").trim() || null,
    payoffGoodThroughDate: input.payoffGoodThroughDate ?? null,
    titleInHand: input.titleInHand ?? null,
    titleState: (input.titleState ?? "").trim() || null,
    hasSecondKey: input.hasSecondKey ?? null,
    photoUrls: input.photoUrls ?? [],
    notes: (input.notes ?? "").trim() || null,
    shareConsentAt: now,
  };

  const row = existing
    ? await prisma.tradeInSubmission.update({
        where: { id: existing.id },
        // An edit to a packet a dealer may already have seen is itself a fact: §6.2's
        // appraisal-changed marker is what tells the desk the numbers moved.
        data: { ...data, appraisalChangedAt: now },
        select: PACKET_SELECT,
      })
    : await prisma.tradeInSubmission.create({
        data: { buyerId, vehicleRequestId: requestId, status: TradeInStatus.SUBMITTED, ...data },
        select: PACKET_SELECT,
      });

  await prisma.vehicleRequest.update({
    where: { id: requestId },
    data: { tradeElected: true, updatedAt: now },
    select: { id: true },
  });
  await mirrorTradeToFinancing(requestId, true);

  return { ok: true, elected: true, packet: toPacket(row as Record<string, unknown>) };
}

/**
 * Keep `VehicleRequestFinancing.tradeIn` in step with the election.
 *
 * That column is the OLDER answer to the same question and is read by financing surfaces that
 * predate `trade_elected`. It cannot serve as the election itself — the financing relation is
 * optional, so "no financing row" and "the buyer has not answered" are the same observation —
 * but leaving it stale would give two surfaces two different answers. Best-effort: a mirror
 * failure must not fail the election the buyer just made.
 */
async function mirrorTradeToFinancing(requestId: string, tradeIn: boolean): Promise<void> {
  try {
    await prisma.vehicleRequestFinancing.updateMany({ where: { vehicleRequestId: requestId }, data: { tradeIn } });
  } catch (err) {
    logger.warn("[trade-in] financing mirror failed; the election itself is recorded:", err);
  }
}
