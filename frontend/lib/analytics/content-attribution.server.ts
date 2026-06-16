// Phase C-Attribution — server side of content attribution + conversion.
//
// Three jobs:
//   1. recordContentAttribution — at lead time, read the last-touch cookie and
//      persist a ContentAttribution row linking the lead to its article.
//   2. reconcileContentConversions — mark rows converted once the linked
//      BuyerOpportunity has a paid deposit or a created deal.
//   3. markContentConversion — explicit fast-path for a deposit/deal webhook.
//
// Everything is best-effort and wrapped in try/catch: attribution must never
// break a buyer's submission or the admin dashboard render.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  ATTRIBUTION_COOKIE,
  parseTouch,
  type ContentAttributionTouch,
} from "@/lib/analytics/attribution";

/** Pull the content last-touch out of a raw `Cookie:` header value. */
export function getAttributionFromCookieHeader(
  cookieHeader: string | null | undefined,
): ContentAttributionTouch | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split("; ")
    .find((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`));
  if (!match) return null;
  try {
    return parseTouch(decodeURIComponent(match.slice(ATTRIBUTION_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

/**
 * Persist a content-attributed lead. No-op when the lead did not originate from
 * a content article (no touch cookie). Never throws.
 */
export async function recordContentAttribution(params: {
  touch: ContentAttributionTouch | null;
  source: string;
  buyerOpportunityId?: string | null;
  email?: string | null;
  leadTemperature?: string | null;
}): Promise<void> {
  const { touch } = params;
  if (!touch) return;
  try {
    await prisma.contentAttribution.create({
      data: {
        articleSlug: touch.slug,
        cluster: touch.cluster,
        city: touch.city,
        state: touch.state,
        metro: touch.metro ?? null,
        source: params.source,
        buyerOpportunityId: params.buyerOpportunityId ?? null,
        email: params.email?.toLowerCase() ?? null,
        leadTemperature: params.leadTemperature ?? null,
      },
    });
  } catch (err) {
    logger.error("[content-attribution] recordContentAttribution failed", err);
  }
}

/**
 * Reconcile pending (un-converted) attributions against their linked
 * BuyerOpportunity. A lead counts as converted when the opportunity's buyer has
 * a PAID deposit or any linked VehicleRequest reached DEAL_CREATED. Conversion
 * value is the sum of PAID deposits. Returns the number of rows newly marked.
 *
 * Batched: two reads regardless of pending volume. Safe to call on every
 * dashboard render (admin-only, low volume).
 */
export async function reconcileContentConversions(): Promise<number> {
  try {
    const pending = await prisma.contentAttribution.findMany({
      where: { converted: false, buyerOpportunityId: { not: null } },
      select: { id: true, buyerOpportunityId: true },
    });
    if (pending.length === 0) return 0;

    const oppIds = [
      ...new Set(pending.map((p) => p.buyerOpportunityId).filter((v): v is string => !!v)),
    ];

    const opps = await prisma.buyerOpportunity.findMany({
      where: { id: { in: oppIds } },
      select: {
        id: true,
        vehicleRequests: { select: { status: true } },
        buyer: { select: { deposits: { select: { status: true, amountCents: true } } } },
      },
    });

    // Per-opportunity conversion verdict + value (cents).
    const verdict = new Map<string, { converted: boolean; valueCents: number }>();
    for (const opp of opps) {
      const paid = (opp.buyer?.deposits ?? []).filter((d) => d.status === "PAID");
      const dealCreated = opp.vehicleRequests.some((r) => r.status === "DEAL_CREATED");
      const converted = dealCreated || paid.length > 0;
      const valueCents = paid.reduce((sum, d) => sum + (d.amountCents ?? 0), 0);
      verdict.set(opp.id, { converted, valueCents });
    }

    const now = new Date();
    let updated = 0;
    for (const row of pending) {
      const v = row.buyerOpportunityId ? verdict.get(row.buyerOpportunityId) : undefined;
      if (!v?.converted) continue;
      await prisma.contentAttribution.update({
        where: { id: row.id },
        data: {
          converted: true,
          convertedAt: now,
          conversionValueCents: v.valueCents || null,
        },
      });
      updated++;
    }
    return updated;
  } catch (err) {
    logger.error("[content-attribution] reconcileContentConversions failed", err);
    return 0;
  }
}

/**
 * Explicitly mark content attributions converted — for a deposit/deal webhook
 * that already knows the buyerOpportunityId (or buyer email). Returns the count
 * of rows updated. Never throws.
 */
export async function markContentConversion(params: {
  buyerOpportunityId?: string | null;
  email?: string | null;
  conversionValueCents?: number | null;
}): Promise<number> {
  const { buyerOpportunityId, email } = params;
  if (!buyerOpportunityId && !email) return 0;
  try {
    const { count } = await prisma.contentAttribution.updateMany({
      where: {
        converted: false,
        ...(buyerOpportunityId
          ? { buyerOpportunityId }
          : { email: email!.toLowerCase() }),
      },
      data: {
        converted: true,
        convertedAt: new Date(),
        conversionValueCents: params.conversionValueCents ?? null,
      },
    });
    return count;
  } catch (err) {
    logger.error("[content-attribution] markContentConversion failed", err);
    return 0;
  }
}
