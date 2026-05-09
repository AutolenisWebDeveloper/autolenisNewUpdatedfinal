import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getAuctionWithOffers } from "@/lib/services/auction/auction.service";

interface Props { params: Promise<{ auctionId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const auction = await getAuctionWithOffers(auctionId);
  if (!auction) return adminError("NOT_FOUND", "Auction not found", 404);
  return adminSuccess({ auction });
}
