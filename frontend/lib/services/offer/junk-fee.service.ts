// lib/services/offer/junk-fee.service.ts
//
// §8b: "Junk-fee patterns and APR flags are evaluated [BUILT]."
//
// They were not. Until Phase 6 this module had ZERO callers repo-wide, so no fee was ever
// classified server-side and `JunkFeePattern` — an admin-maintained table — was consulted by
// nothing. The only `isJunk` decision in the running system lived in the dealer quick-bid UI
// (`quick-offer/[auctionId]/page.tsx:103`, a hardcoded keyword list) and was discarded before
// persistence, because the form sent only `{ name, amount }`.
//
// `submitOffer` and `reviseOffer` now call `classifyFeeItems` on every submission, so the flag on
// each stored item is the server's and the admin's patterns finally bind.

import { prisma } from "@/lib/prisma";
import { normalizeJunkFeeItems, junkFeeTotalCents, type JunkFeeItem } from "./junk-fee-items";

const BUILT_IN_JUNK = ["nitrogen", "nitro tire", "vin etch", "paint protection", "ppf", "dealer prep", "advertising", "market adjustment"];

/**
 * Stamp `isJunk` on each item from the built-in list unioned with the active `JunkFeePattern`
 * rows. Input may be any of the three shapes `junk-fee-items.ts` accepts; output is canonical.
 *
 * FAILS OPEN, deliberately and narrowly: if the pattern table cannot be read, items are returned
 * with the built-in list applied rather than unclassified. The alternative — refusing the
 * submission — would let a database hiccup on an ADVISORY table block a dealer's bid, and §8b
 * makes junk-fee evaluation a signal for ranking, not a gate on acceptance. The degradation is
 * logged by the caller, never silent.
 */
export async function classifyFeeItems(raw: unknown): Promise<JunkFeeItem[]> {
  const items = normalizeJunkFeeItems(raw);
  if (items.length === 0) return items;

  let keywords = BUILT_IN_JUNK;
  try {
    const dbPatterns = await prisma.junkFeePattern.findMany({ where: { isActive: true } });
    keywords = [...BUILT_IN_JUNK, ...dbPatterns.flatMap((p) => p.keywords)];
  } catch {
    // Built-ins only. Reported by the caller; see the fail-open note above.
  }

  const lowered = keywords.map((k) => k.toLowerCase());
  return items.map((item) => ({
    ...item,
    isJunk: lowered.some((kw) => item.name.toLowerCase().includes(kw)),
  }));
}

/** Back-compat alias for the pre-Phase-6 name. Same behaviour, canonical output. */
export async function detectJunkFees(feeItems: unknown): Promise<JunkFeeItem[]> {
  return classifyFeeItems(feeItems);
}

/** Total of the classified junk items, in CENTS. Previously returned dollars-or-cents ambiguously. */
export async function getTotalJunkFeesCents(feeItems: unknown): Promise<number> {
  return junkFeeTotalCents(await classifyFeeItems(feeItems));
}
