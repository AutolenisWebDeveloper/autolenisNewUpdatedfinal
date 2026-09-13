import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const deals = await prisma.deal.findMany({
    include: { buyer: { select: { firstName: true, lastName: true } }, offer: { include: { dealer: { select: { dealershipName: true } } } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return adminSuccess({ deals });
}

// ── POST RETIRED — §9: "No system, algorithm, or administrator selects on the buyer's behalf." ──
//
// This route took `buyerId` and `offerId` from the request body and minted a Deal, marking the
// offer ACCEPTED. That is an ADMINISTRATOR SELECTING THE WINNER, which §9 forbids in as many
// words, and §8.2 Phase 6 defect (3) retires it: "selection exists only on the buyer route".
//
// WHAT WAS LOST, stated rather than assumed. Nothing reachable: a repo-wide search for callers of
// the collection endpoint found none — every `/api/admin/deals` hit in the codebase is a
// `/[dealId]/…` sub-route, plus one SSRF fixture string in
// `contract-shield/__tests__/contract-document-ref.test.ts:39`. No admin screen, script or test
// drove it. GET is untouched and still backs the admin deals list.
//
// It also bypassed every guard the buyer path has: no `SELECT … FOR UPDATE` on the auction, so two
// concurrent calls could each mint a Deal; no approval recheck; no auction-status check, so a
// PENDING or CANCELLED auction's offer was selectable; and no lineage beyond buyer and offer.
//
// REVERTING is restoring this block from git history — §8.2's rollback paragraph says exactly
// that: "Retiring the admin selection route is a delete: reverting restores it." Operations
// recovering a stuck selection uses `POST /api/admin/deals/[dealId]/action`, which is audited and
// state-machine guarded, or asks the buyer to select.
//
// An admin needing to correct a wrong winner has no self-service path and should not: that is a
// buyer decision with money attached, and §26 routes it through an Operations case.
