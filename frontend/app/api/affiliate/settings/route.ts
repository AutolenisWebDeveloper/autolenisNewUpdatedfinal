import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  emailEnabled:       z.boolean().optional(),
  inAppEnabled:       z.boolean().optional(),
  auctionUpdates:     z.boolean().optional(),
  commissionUpdates:  z.boolean().optional(),
  marketingEmails:    z.boolean().optional(),
});

// GET /api/affiliate/settings — fetch notification preferences
export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId: affiliate.userId },
  });

  return successResponse({
    emailEnabled:      prefs?.emailEnabled ?? true,
    inAppEnabled:      prefs?.inAppEnabled ?? true,
    auctionUpdates:    prefs?.auctionUpdates ?? true,
    commissionUpdates: prefs?.commissionUpdates ?? true,
    marketingEmails:   prefs?.marketingEmails ?? false,
  });
}

// PATCH /api/affiliate/settings — save notification preferences
export async function PATCH(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);

  const prefs = await prisma.notificationPreference.upsert({
    where: { userId: affiliate.userId },
    create: { userId: affiliate.userId, ...parsed.data },
    update: { ...parsed.data },
  });

  return successResponse({
    emailEnabled:      prefs.emailEnabled,
    inAppEnabled:      prefs.inAppEnabled,
    auctionUpdates:    prefs.auctionUpdates,
    commissionUpdates: prefs.commissionUpdates,
    marketingEmails:   prefs.marketingEmails,
  });
}
