// lib/services/pickup/pickup-sla.service.ts
// D2b — pickup confirmation SLA nudges (cron-scan). Mirrors the established
// reminder pattern (dealer-invitation-reminder / prequal-sla-escalation): scan
// for rows aged past the SLA that haven't been nudged yet, notify, and stamp a
// per-side marker so each round is nudged at most once. The markers are reset on
// each new proposal by the coordination service, so a fresh round re-arms them.

import { prisma } from "@/lib/prisma";
import { PickupStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { PICKUP_CONFIRM_SLA_HOURS, PICKUP_ACCEPT_SLA_HOURS } from "./pickup-coordination.service";
import { notifyDealerProposalReminder, notifyBuyerCounterReminder } from "./pickup-notifications.service";

export { PICKUP_CONFIRM_SLA_HOURS, PICKUP_ACCEPT_SLA_HOURS };

const BATCH_LIMIT = 200; // bound each run; the next run picks up the remainder

type SlaPrisma = {
  pickup: {
    findMany: (args: unknown) => Promise<Array<{ dealId: string }>>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export interface NudgeDeps {
  prisma: SlaPrisma;
  notifyDealerProposalReminder: (dealId: string) => Promise<void>;
  notifyBuyerCounterReminder: (dealId: string) => Promise<void>;
}

const defaultDeps: NudgeDeps = {
  prisma: prisma as unknown as SlaPrisma,
  notifyDealerProposalReminder,
  notifyBuyerCounterReminder,
};

export async function runPickupConfirmationNudges(
  now: Date = new Date(),
  deps: NudgeDeps = defaultDeps,
): Promise<{ dealerNudged: number; buyerNudged: number }> {
  const confirmCutoff = new Date(now.getTime() - PICKUP_CONFIRM_SLA_HOURS * 3600_000);
  const acceptCutoff = new Date(now.getTime() - PICKUP_ACCEPT_SLA_HOURS * 3600_000);

  // Dealer hasn't confirmed a buyer proposal within the SLA.
  const dealerPending = await deps.prisma.pickup.findMany({
    where: {
      status: PickupStatus.PROPOSED,
      proposedAt: { lt: confirmCutoff },
      proposedReminderSentAt: null,
    },
    select: { dealId: true },
    take: BATCH_LIMIT,
  });

  let dealerNudged = 0;
  for (const p of dealerPending) {
    try {
      await deps.notifyDealerProposalReminder(p.dealId);
      await deps.prisma.pickup.update({ where: { dealId: p.dealId }, data: { proposedReminderSentAt: now } });
      dealerNudged += 1;
    } catch (e) {
      logger.error(`[pickup-sla] dealer nudge failed deal=${p.dealId}:`, e);
    }
  }

  // Buyer hasn't accepted/countered the dealer's counter within the SLA.
  const buyerPending = await deps.prisma.pickup.findMany({
    where: {
      status: PickupStatus.DEALER_COUNTERED,
      proposedAt: { lt: acceptCutoff },
      counterReminderSentAt: null,
    },
    select: { dealId: true },
    take: BATCH_LIMIT,
  });

  let buyerNudged = 0;
  for (const p of buyerPending) {
    try {
      await deps.notifyBuyerCounterReminder(p.dealId);
      await deps.prisma.pickup.update({ where: { dealId: p.dealId }, data: { counterReminderSentAt: now } });
      buyerNudged += 1;
    } catch (e) {
      logger.error(`[pickup-sla] buyer nudge failed deal=${p.dealId}:`, e);
    }
  }

  return { dealerNudged, buyerNudged };
}
