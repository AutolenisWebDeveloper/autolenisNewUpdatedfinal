// POST /api/admin/buyers/[buyerId]/workflow/pause
// Pause (cancel) an active auction for a buyer.
// Logs to AdminAuditLog. Requires reason.

import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { pauseBuyerWorkflow } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  auctionId: z.string().min(1, "Auction ID is required"),
  reason: z.string().min(1, "Reason is required for workflow pause"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;

  // §8.2 Phase 10 defect (7), and §28.3 #1. This route required only an AUTHENTICATED
  // admin — `getAdminFromRequest` then a null check — while writing
  // `AuctionStatus.CANCELLED`, which ends a buyer's live auction. Every sibling
  // action route gates on a role; this one did not, so a SUPPORT_ADMIN could cancel
  // any auction.
  //
  // STRICT, NOT SHADOW, AND THAT DISTINCTION IS THE WHOLE FIX. `requirePermission`
  // says so in its own header: "requirePermission NEVER blocks; on a would-be denial
  // it writes an `rbac.shadow_deny` audit record and allows the request", and
  // flipping RBAC_ENFORCE is a separate operator decision that must not be taken
  // here. Gating this route with the shadow helper would have LOOKED like a fix,
  // recorded a denial, and still cancelled the auction.
  //
  // `requirePermissionStrict` hard-denies regardless of RBAC_ENFORCE and derives its
  // allow-list from PERMISSION_ROLES, so it enforces the tier the owner already ruled
  // (`deals.cancel: OPS` — SUPER_ADMIN and OPERATIONS_ADMIN) rather than inventing a
  // new policy at the call site. permissions.ts already carves out exactly this case:
  // "a shadow gate is not sufficient for a route that moves money, fans out sends, or
  // replays arbitrary jobs — there, 'recorded but allowed' is an authorization defect,
  // not a rollout stage."
  const check = await requirePermissionStrict(request, "deals.cancel");
  if (!check.ok) return adminError(check.code, check.message, check.status);
  const admin = check.admin;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await pauseBuyerWorkflow(
      buyerId,
      admin.adminId,
      admin.email,
      parsed.data.auctionId,
      parsed.data.reason
    );
    return adminSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to pause workflow";
    return adminError("ACTION_FAILED", message, 422);
  }
}
