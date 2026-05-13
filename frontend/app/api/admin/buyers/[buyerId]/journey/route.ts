import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { getAdminBuyerJourney } from "@/lib/services/admin/buyer-journey-admin.service";

interface Props { params: Promise<{ buyerId: string }> }
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { buyerId } = await params;
  const journey = await getAdminBuyerJourney(buyerId);
  if (!journey) return adminError("NOT_FOUND", "Buyer not found", 404);
  return adminSuccess({ journey });
}
