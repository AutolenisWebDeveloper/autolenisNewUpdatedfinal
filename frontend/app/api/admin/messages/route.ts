// GET  /api/admin/messages      — list all threads (paginated)
// POST /api/admin/messages      — admin creates a new support thread for a buyer

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  buyerUserId: z.string().uuid(),
  subject: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(4000),
});

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const perPage = 20;

  const [threads, total] = await Promise.all([
    prisma.messageThread.findMany({
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        messages: { orderBy: { sentAt: "desc" }, take: 1 },
        participants: { select: { userId: true, role: true } },
      },
    }),
    prisma.messageThread.count(),
  ]);

  // Attach buyer info to each thread
  const buyerUserIds = threads
    .flatMap(t => t.participants)
    .filter(p => p.role === "BUYER")
    .map(p => p.userId);

  const buyers = buyerUserIds.length
    ? await prisma.buyer.findMany({
        where: { userId: { in: buyerUserIds } },
        select: { userId: true, firstName: true, lastName: true },
      })
    : [];

  const buyerMap = new Map(buyers.map(b => [b.userId, b]));

  const enriched = threads.map(t => {
    const buyerParticipant = t.participants.find(p => p.role === "BUYER");
    const buyer = buyerParticipant ? buyerMap.get(buyerParticipant.userId) : undefined;
    return {
      id: t.id,
      status: t.status,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      latestMessage: t.messages[0]
        ? {
            content: t.messages[0].isRedacted ? "[Redacted]" : t.messages[0].content,
            sentAt: t.messages[0].sentAt,
          }
        : null,
      buyer: buyer
        ? { firstName: buyer.firstName, lastName: buyer.lastName }
        : null,
    };
  });

  return adminSuccess({ threads: enriched, total, page, perPage });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON", 400);
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const { buyerUserId, message } = parsed.data;

  // Verify buyer exists
  const buyer = await prisma.buyer.findUnique({ where: { userId: buyerUserId } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  // Find admin user record
  const adminUser = await prisma.admin.findUnique({
    where: { id: admin.adminId },
    include: { user: true },
  });
  if (!adminUser) return adminError("NOT_FOUND", "Admin user not found", 404);

  // Create thread with both participants
  const thread = await prisma.messageThread.create({
    data: {
      status: "ACTIVE",
      lastMessageAt: new Date(),
      participants: {
        create: [
          { userId: buyerUserId, role: "BUYER" },
          { userId: adminUser.userId, role: "ADMIN" },
        ],
      },
      messages: {
        create: {
          senderId: adminUser.userId,
          content: message,
        },
      },
    },
    include: {
      messages: true,
      participants: true,
    },
  });

  return adminSuccess({ thread }, 201);
}
