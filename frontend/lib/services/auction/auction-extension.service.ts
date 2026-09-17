// lib/services/auction/auction-extension.service.ts
import { prisma } from "@/lib/prisma";
import { extendAuction } from "./auction.service";

/**
 * A manual extension did not apply because the auction moved under it.
 *
 * Separate from "auction not found": the auction exists and the caller's view of its
 * deadline was simply stale, which is a retry, not an error to report to an operator
 * as a failure.
 */
export class ExtensionRaceLost extends Error {
  code = "EXTENSION_RACE_LOST";
  constructor(public readonly auctionId: string) {
    super(
      `Auction ${auctionId} was extended or closed by another writer. Re-read it and retry — the deadline you observed is no longer current.`,
    );
    this.name = "ExtensionRaceLost";
  }
}

export async function requestExtension(auctionId: string, hours: number, adminId: string, reason: string) {
  const auction = await extendAuction(auctionId, hours, adminId, reason);

  // §28.3 #3/#6, PHASE 10. `extendAuction` is now conditional on the deadline it
  // computed from, so it returns null when a concurrent writer moved the auction
  // first. The log write below used to run unconditionally — which meant a LOST race
  // still wrote an `AuctionExtensionLog` row claiming an extension that had been
  // overwritten, and the extension history recorded hours the auction never had.
  //
  // Refusing here keeps the log a record of extensions that happened.
  if (!auction?.endsAt) throw new ExtensionRaceLost(auctionId);

  await prisma.auctionExtensionLog.create({
    data: {
      auctionId,
      extendedBy: adminId,
      hoursAdded: hours,
      originalEnd: new Date(auction.endsAt.getTime() - hours * 3600000),
      newEnd: auction.endsAt,
      reason,
    },
  });
  return auction;
}

export async function getExtensionHistory(auctionId: string) {
  return prisma.auctionExtensionLog.findMany({ where: { auctionId }, orderBy: { createdAt: "asc" } });
}
