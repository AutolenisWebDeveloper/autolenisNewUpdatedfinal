import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { getNetworkSize } from "@/lib/services/affiliate/commission.service";
import { prisma } from "@/lib/prisma";

// F8 — GET /api/affiliate/network
export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const [network, l1Members] = await Promise.all([
    getNetworkSize(affiliate.id),
    prisma.affiliate.findMany({
      where: { parentId: affiliate.id },
      include: {
        user: { select: { email: true } },
        children: {
          select: { id: true, user: { select: { email: true } }, children: { select: { id: true } } },
        },
      },
    }),
  ]);

  // Mask emails for privacy
  function maskEmail(email: string) {
    const [u, d] = email.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }

  const tree = l1Members.map(l1 => ({
    id: l1.id,
    email: maskEmail(l1.user.email),
    level: 1,
    children: l1.children.map(l2 => ({
      id: l2.id,
      email: maskEmail(l2.user.email),
      level: 2,
      childCount: l2.children.length,
    })),
  }));

  return successResponse({ network, tree, totalMembers: network.l1 + network.l2 + network.l3 });
}
