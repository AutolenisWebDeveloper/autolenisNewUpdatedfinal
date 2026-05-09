import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";

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

  // Check no existing ACTIVE auction for this buyer
  const existing = await prisma.auction.findFirst({ where: { buyerId, status: { in: ["PENDING", "ACTIVE"] } } });
  if (existing) return adminError("AUCTION_EXISTS", "Buyer already has an open auction", 400);

  const durationHours = hours ?? AUCTION_DURATION_HOURS;
  const endsAt = new Date(Date.now() + durationHours * 3600000);

  const auction = await prisma.auction.create({
    data: {
      buyerId,
      depositId,
      status: "ACTIVE",
      startedAt: new Date(),
      endsAt,
    },
  });

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

