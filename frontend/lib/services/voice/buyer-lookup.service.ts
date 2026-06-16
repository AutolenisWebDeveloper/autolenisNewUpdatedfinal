// Zura Intelligence Phase 2 — returning-caller recognition.
//
// When a buyer calls the voice receptionist, look their phone number up in the
// BuyerOpportunity table so Zura can greet them by name and reference the
// vehicle request they already submitted instead of starting from scratch.
//
// This module is strictly READ-ONLY. It runs on the hot path of every inbound
// call, so it must NEVER throw — any failure falls through to a "not found"
// result and Zura proceeds with the standard new-caller flow.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export interface BuyerLookupResult {
  found: boolean;
  buyerOpportunityId: string | null;
  firstName: string | null;
  make: string | null;
  model: string | null;
  // BuyerOpportunity stores a year *range*, not a single year. yearMin is the
  // most useful single value for a spoken greeting ("a 2024 Camry").
  yearMin: number | null;
  yearMax: number | null;
  trim: string | null;
  // Budget is stored in CENTS on BuyerOpportunity.budgetAmount.
  budgetCents: number | null;
  timeline: string | null;
  // There is no status enum on BuyerOpportunity — completion is a boolean.
  completed: boolean | null;
  callReason: string | null;
  createdAt: Date | null;
}

const NOT_FOUND: BuyerLookupResult = {
  found: false,
  buyerOpportunityId: null,
  firstName: null,
  make: null,
  model: null,
  yearMin: null,
  yearMax: null,
  trim: null,
  budgetCents: null,
  timeline: null,
  completed: null,
  callReason: null,
  createdAt: null,
};

// Build the set of phone string variants we might find in the database. Twilio
// delivers E.164 ("+14695551234"), but historical records may have been stored
// without the country code or without the leading plus. We query for any of:
//   +14695551234  (E.164 with country code)
//   14695551234   (11 digits, no plus)
//   4695551234    (10 digits, local)
//   +4695551234   (plus without country code — defensive)
export function phoneVariants(rawPhone: string): string[] {
  const digits = (rawPhone || "").replace(/\D/g, "");
  if (digits.length < 10) return [];

  // Normalize to the trailing 10 national digits.
  const last10 = digits.slice(-10);
  const variants = new Set<string>([
    `+1${last10}`,
    `1${last10}`,
    last10,
    `+${last10}`,
  ]);
  // Always include exactly what Twilio handed us, in case it's an unusual shape.
  if (rawPhone) variants.add(rawPhone.trim());
  return [...variants].filter(Boolean);
}

// Look up the most relevant existing BuyerOpportunity for a caller's phone.
// Prefers the most recent record that actually carries vehicle interest
// (make/model) so Zura has something concrete to reference; falls back to the
// most recent record of any kind. Returns NOT_FOUND on no match or any error.
export async function lookupBuyerByPhone(
  rawPhone: string,
): Promise<BuyerLookupResult> {
  try {
    const variants = phoneVariants(rawPhone);
    if (variants.length === 0) {
      logger.info(`[zura-phase2] Skipping lookup — unparseable phone: "${rawPhone}"`);
      return NOT_FOUND;
    }

    const select = {
      id: true,
      firstName: true,
      make: true,
      model: true,
      yearMin: true,
      yearMax: true,
      trim: true,
      budgetAmount: true,
      timeline: true,
      completed: true,
      callReason: true,
      createdAt: true,
    } as const;

    // Prefer the most recent record with a known vehicle so the greeting can
    // reference it; otherwise take the most recent record of any kind.
    const withVehicle = await prisma.buyerOpportunity.findFirst({
      where: { phone: { in: variants }, make: { not: null } },
      orderBy: { createdAt: "desc" },
      select,
    });

    const record =
      withVehicle ??
      (await prisma.buyerOpportunity.findFirst({
        where: { phone: { in: variants } },
        orderBy: { createdAt: "desc" },
        select,
      }));

    if (!record) {
      logger.info(`[zura-phase2] No buyer match for ${variants[0]}`);
      return NOT_FOUND;
    }

    logger.info(
      `[zura-phase2] Caller ${variants[0]} matched BuyerOpportunity ${record.id} ` +
        `(${record.firstName ?? "unknown"}, ${record.make ?? "—"} ${record.model ?? ""})`,
    );

    return {
      found: true,
      buyerOpportunityId: record.id,
      firstName: record.firstName ?? null,
      make: record.make ?? null,
      model: record.model ?? null,
      yearMin: record.yearMin ?? null,
      yearMax: record.yearMax ?? null,
      trim: record.trim ?? null,
      budgetCents: record.budgetAmount ?? null,
      timeline: record.timeline ?? null,
      completed: record.completed ?? null,
      callReason: record.callReason ?? null,
      createdAt: record.createdAt ?? null,
    };
  } catch (err) {
    // Never crash the call on a lookup failure.
    logger.error(
      `[zura-phase2] lookupBuyerByPhone failed: ${err instanceof Error ? err.message : err}`,
    );
    return NOT_FOUND;
  }
}

// Spoken opening line. Personalized for a recognized caller, otherwise the
// standard new-caller greeting (unchanged wording from the prior flow).
export function buildGreeting(ctx: BuyerLookupResult | null): string {
  const DEFAULT =
    "Thank you for calling AutoLenis. This is Zura. How can I help you find your next vehicle today?";

  if (!ctx || !ctx.found || !ctx.firstName) return DEFAULT;

  const name = ctx.firstName;
  const vehicle = [ctx.yearMin, ctx.make, ctx.model]
    .filter(Boolean)
    .join(" ")
    .trim();

  // Completed search → invite them back for a new vehicle.
  if (ctx.completed) {
    if (vehicle) {
      return (
        `Hi ${name}! Great to hear from you again. This is Zura at AutoLenis. ` +
        `Your ${vehicle} search was all wrapped up — are you looking for another ` +
        `vehicle, or is there something else I can help with today?`
      );
    }
    return (
      `Hi ${name}! Great to hear from you again at AutoLenis. This is Zura. ` +
      `What can I help you with today?`
    );
  }

  // Active request → reference it and ask if they want an update.
  if (vehicle) {
    return (
      `Hi ${name}! It's Zura at AutoLenis. I see you're looking for a ${vehicle} — ` +
      `are you calling for an update on that search, or is there something else ` +
      `I can help you with today?`
    );
  }

  return (
    `Hi ${name}! Welcome back to AutoLenis. This is Zura. ` +
    `How can I help you today?`
  );
}
