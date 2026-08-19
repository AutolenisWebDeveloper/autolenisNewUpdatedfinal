// Y6 — auction anti-snipe auto-extension.
//
// A bid in the final SNIPE_WINDOW_MINUTES pushes endsAt out by EXTENSION_MINUTES
// so competitors get a chance to respond, capped at MAX_AUTO_EXTENSIONS. The push
// is a single atomic updateMany guarded on (status ACTIVE + the exact endsAt we
// read + count < cap), so two concurrent last-second bids can extend at most once
// (the second's exact-endsAt guard no longer matches). closeExpiredAuctions is
// untouched — it reads the live endsAt.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";

export const SNIPE_WINDOW_MINUTES = 5;
export const EXTENSION_MINUTES = 5;
export const MAX_AUTO_EXTENSIONS = 6; // max +30 min

const SNIPE_WINDOW_MS = SNIPE_WINDOW_MINUTES * 60_000;
const EXTENSION_MS = EXTENSION_MINUTES * 60_000;

export interface AntiSnipeDeps {
  prisma: PrismaClient;
  now: Date;
}

export interface AntiSnipeResult {
  extended: boolean;
  newEndsAt?: Date;
  count?: number;
}

/**
 * Extend the auction if a bid just landed inside the snipe window. Idempotent-safe
 * under concurrency and best-effort by contract: callers invoke it after an offer
 * commits and ignore failures (an extension must never break offer submission).
 */
export async function maybeExtendForAntiSnipe(
  auctionId: string,
  deps?: Partial<AntiSnipeDeps>,
): Promise<AntiSnipeResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { id: true, status: true, endsAt: true, autoExtensionCount: true },
  });
  if (!auction || auction.status !== "ACTIVE" || !auction.endsAt) return { extended: false };

  const endsAt = auction.endsAt;
  const msLeft = endsAt.getTime() - now.getTime();
  if (msLeft <= 0 || msLeft > SNIPE_WINDOW_MS) return { extended: false }; // ended or not in window
  if (auction.autoExtensionCount >= MAX_AUTO_EXTENSIONS) return { extended: false }; // capped

  const newEndsAt = new Date(endsAt.getTime() + EXTENSION_MS);

  // Atomic guard: only one concurrent bid wins (exact-endsAt match), never past
  // the cap, only while ACTIVE.
  const res = await prisma.auction.updateMany({
    where: { id: auctionId, status: "ACTIVE", endsAt, autoExtensionCount: { lt: MAX_AUTO_EXTENSIONS } },
    data: { endsAt: newEndsAt, autoExtensionCount: { increment: 1 }, extendedAt: now, extendReason: "anti_snipe" },
  });
  if (res.count !== 1) return { extended: false }; // lost the race or capped concurrently

  const count = auction.autoExtensionCount + 1;
  try {
    await prisma.auctionExtensionLog.create({
      data: {
        auctionId,
        source: "ANTI_SNIPE",
        extendedBy: "system",
        hoursAdded: 0,
        minutesAdded: EXTENSION_MINUTES,
        originalEnd: endsAt,
        newEnd: newEndsAt,
        reason: "anti_snipe",
      },
    });
  } catch (err) {
    logger.warn(`[anti-snipe] extension log failed for auction ${auctionId}:`, err);
  }

  logger.info(`[anti-snipe] extended auction ${auctionId} to ${newEndsAt.toISOString()} (#${count})`);
  return { extended: true, newEndsAt, count };
}
