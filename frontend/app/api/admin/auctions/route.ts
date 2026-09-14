import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import {
  isDepositAuctionUniqueViolation,
  LIVE_AUCTION_STATUSES,
  resolveRelaunchEligibility,
} from "@/lib/services/auction/deposit-auction";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const auctions = await prisma.auction.findMany({
    include: { buyer: { select: { firstName: true, lastName: true } }, _count: { select: { offers: true, invitations: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return adminSuccess({ auctions });
}

const createSchema = z.object({
  buyerId:   z.string().min(1),
  depositId: z.string().min(1),
  reason:    z.string().min(1),
  hours:     z.number().int().positive().optional(),
});

// POST /api/admin/auctions — admin creates auction linked to buyer's deposit
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { buyerId, depositId, reason, hours } = parsed.data;

  const deposit = await prisma.deposit.findFirst({ where: { id: depositId, buyerId, status: "PAID" } });
  if (!deposit) return adminError("DEPOSIT_NOT_PAID", "Deposit not found or not in PAID status", 400);

  // Check no existing LIVE auction for this buyer.
  //
  // `LIVE_AUCTION_STATUSES`, not a hand-written `["PENDING","ACTIVE"]`. The literal list omitted
  // REOPENED — an auction that is unambiguously still running — so a buyer whose auction had been
  // reopened passed this guard. One list, owned by `deposit-auction.ts`, is what keeps the four
  // readers of "is this auction still live?" from disagreeing.
  const existing = await prisma.auction.findFirst({
    where: { buyerId, status: { in: LIVE_AUCTION_STATUSES } },
  });
  if (existing) return adminError("AUCTION_EXISTS", "Buyer already has an open auction", 400);

  // PER-DEPOSIT GUARD (§13-D39). This route had NO per-deposit precondition at all: the check
  // above is per BUYER, and `auctions.deposit_id`'s absolute unique was the only thing stopping a
  // second auction on the same $99. That protection was an unhandled P2002 — a 500, ugly but a
  // refusal. Relaxing the index to a partial one turns that 500 into a silent success, so an admin
  // could mint auction after auction on one deposit and §8c's "one relaunch" would be enforced
  // nowhere. A defect that fails loudly becoming one that fails silently is worse than the defect.
  //
  // The rule is explicit here now: a fresh deposit gets its original; a spent one gets at most one
  // relaunch, correctly parented so the audit survives; beyond that it is refused by name.
  //
  // `resolveRelaunchEligibility`, not a hand-rolled pair of reads. The first version of this guard
  // checked only `relaunchCount` and never asked whether anything on the deposit was STILL LIVE,
  // so a REOPENED original — which the per-buyer check above also missed — let a second live
  // auction be created on one $99, outside `auctions_deposit_id_original_key` and therefore
  // accepted by the database. `findLiveAuctionForDeposit` then resolves to whichever is newest and
  // the close reconciler drives the wrong one. The sibling `launch-auction` route already went
  // through this helper; this one now does too, and the three refusal reasons are named.
  let originalAuctionId: string | null = null;
  const eligibility = await resolveRelaunchEligibility(prisma, depositId);
  if (eligibility.eligible) {
    originalAuctionId = eligibility.originalAuctionId;
  } else if (eligibility.reason === "AUCTION_STILL_LIVE") {
    return adminError(
      "AUCTION_STILL_LIVE",
      "This deposit already has a live auction. Close or cancel it before launching another.",
      409,
    );
  } else if (eligibility.reason === "RELAUNCH_LIMIT_REACHED") {
    return adminError(
      "RELAUNCH_LIMIT_REACHED",
      "This deposit has already used its one relaunch without a second $99 (§8c). Source manually or close the request.",
      409,
    );
  }
  // `NO_AUCTION` is the fresh-deposit case and is the ONE outcome that proceeds: the deposit gets
  // its original, with `originalAuctionId` left null so the partial unique protects it.

  const durationHours = hours ?? AUCTION_DURATION_HOURS;
  const endsAt = new Date(Date.now() + durationHours * 3600000);

  let auction;
  try {
    auction = await prisma.$transaction(async (tx) => {
      const row = await tx.auction.create({
        data: {
          buyerId,
          depositId,
          status: "ACTIVE",
          startedAt: new Date(),
          endsAt,
          ...(originalAuctionId ? { originalAuctionId } : {}),
        },
      });
      if (originalAuctionId) {
        await tx.auction.update({
          where: { id: originalAuctionId },
          data: { relaunchedAt: new Date(), relaunchCount: { increment: 1 } },
        });
      }
      return row;
    });
  } catch (err) {
    // The preconditions above are the guard; this is the residual race (two admins at once). The
    // index refuses the loser, and it gets a named 409 rather than an unexplained 500.
    if (isDepositAuctionUniqueViolation(err)) {
      return adminError(
        "AUCTION_ALREADY_EXISTS",
        "An auction already exists for this deposit, or it has already been relaunched once.",
        409,
      );
    }
    throw err;
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "AUCTION_CREATED",
      entityType: "Auction",
      entityId: auction.id,
      reason,
      metadata: { buyerId, depositId, endsAt: endsAt.toISOString(), status: "ACTIVE" },
    },
  });

  return adminSuccess({ auction: { id: auction.id, buyerId, status: auction.status, endsAt: auction.endsAt } }, 201);
}

