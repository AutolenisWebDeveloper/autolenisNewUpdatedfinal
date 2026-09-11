// POST /api/admin/sourcing/[caseId]/limited-auction — §6c's audited approval, S6-24 and S6-27.
//
// §6c: "3–4 | Limited auction, only with audited Operations approval", and then the four
// conditions: "A limited auction requires a completely searched permitted radius, documented
// scarcity or urgency, disclosure of the field size to the buyer, and an audited approval."
//
// ALL FOUR ARE CHECKED HERE, and three of them are refusals rather than reminders:
//
//   1. A COMPLETELY SEARCHED PERMITTED RADIUS. The case must have exhausted its ladder. An
//      approval at 100 miles when 150 and 250 remain unsearched is not a scarcity finding, it
//      is an impatience finding — so the route refuses while a further band is searchable.
//   2. DOCUMENTED SCARCITY OR URGENCY. A non-empty reason, stored on the audit row. Not a
//      checkbox: the reason is what a later reviewer reads.
//   3. DISCLOSURE OF THE FIELD SIZE TO THE BUYER. Already enqueued when the case entered
//      LIMITED_PENDING_APPROVAL (`sourcing-driver.service.ts`), so the route verifies the row
//      exists rather than sending it again — and refuses if the buyer has not been told.
//   4. AN AUDITED APPROVAL. The `admin_audit_logs` row, with the admin, the reason and the
//      field size.
//
// The approval does not launch anything. It moves the case to READY_TO_LAUNCH, and the §7
// readiness checklist still has to pass — which is why `DEALER_COUNT` in
// `launch-readiness.service.ts` tests `limitedAuctionApprovedAt` rather than trusting a status.

import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import {
  SOURCING_CASE_STATUS,
  getSourcingCaseById,
  transitionCase,
} from "@/lib/services/sourcing/sourcing-case.service";
import {
  nextBandIsSearchable,
  MIN_LIMITED_AUCTION_FIELD,
  MIN_AUTO_LAUNCH_FIELD,
} from "@/lib/services/sourcing/rooftop-sourcing.service";
import { PHASE_5_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";

interface Props { params: Promise<{ caseId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { caseId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  // The same two roles the auction action route admits. §6c calls this an OPERATIONS approval.
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = body.reason?.trim();
  // §6c's "documented scarcity or urgency". The reason IS the documentation.
  if (!reason) {
    return adminError(
      "REASON_REQUIRED",
      "A limited auction requires documented scarcity or urgency. State it.",
      400,
    );
  }

  const sourcingCase = await getSourcingCaseById(caseId);
  if (!sourcingCase) return adminError("NOT_FOUND", "Sourcing case not found", 404);

  if (sourcingCase.status !== SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL) {
    return adminError(
      "INVALID_STATE",
      `This case is ${sourcingCase.status}. Only a case awaiting limited-auction approval can be approved.`,
      409,
    );
  }

  // §6c's field-size window. Above it, the auction launches automatically and needs no
  // approval; below it, no approval is sufficient.
  if (
    sourcingCase.coverageCount < MIN_LIMITED_AUCTION_FIELD ||
    sourcingCase.coverageCount >= MIN_AUTO_LAUNCH_FIELD
  ) {
    return adminError(
      "INVALID_STATE",
      `A limited auction covers ${MIN_LIMITED_AUCTION_FIELD}–${MIN_AUTO_LAUNCH_FIELD - 1} ` +
        `invitation-ready rooftops. This case has ${sourcingCase.coverageCount}.`,
      409,
    );
  }

  // Condition 1 — the permitted radius must be exhausted.
  if (nextBandIsSearchable(sourcingCase.band, sourcingCase.authorizedRadiusMiles)) {
    return adminError(
      "RADIUS_NOT_EXHAUSTED",
      `Band ${sourcingCase.band} still has a wider band to search. §6c requires a completely ` +
        `searched permitted radius before a limited auction may be approved.`,
      409,
    );
  }

  // Condition 3 — the buyer must have been told the field size.
  const disclosure = await prisma.commsOutbox.findFirst({
    where: {
      vehicleRequestId: sourcingCase.vehicleRequestId,
      templateKey: PHASE_5_TEMPLATES.SOURCING_LIMITED_FIELD,
    },
    select: { id: true, status: true },
  });
  if (!disclosure) {
    return adminError(
      "DISCLOSURE_MISSING",
      "§6c requires the field size to be disclosed to the buyer before a limited auction is " +
        "approved, and no disclosure has been queued for this case.",
      409,
    );
  }

  const moved = await transitionCase({
    caseId,
    to: SOURCING_CASE_STATUS.READY_TO_LAUNCH,
    reason: `limited auction approved by ${admin.email}: ${reason}`,
    limitedAuctionApprovedBy: admin.adminId,
    limitedAuctionApprovedAt: new Date(),
  });
  if (!moved.ok) {
    return adminError(
      "CONFLICT",
      "The case moved while this approval was being recorded. Reload and try again.",
      409,
    );
  }

  // Condition 4 — the audited approval.
  await createAuditLog(admin, request, {
    action: "STATUS_CHANGE",
    entityType: "SourcingCase",
    entityId: caseId,
    reason,
    metadata: {
      event: "LIMITED_AUCTION_APPROVED",
      readyCount: sourcingCase.coverageCount,
      band: sourcingCase.band,
      authorizedRadiusMiles: sourcingCase.authorizedRadiusMiles,
      buyerDisclosureOutboxId: disclosure.id,
      buyerDisclosureStatus: disclosure.status,
    },
    previousState: { status: sourcingCase.status },
    newState: { status: SOURCING_CASE_STATUS.READY_TO_LAUNCH },
  });

  logger.info(
    `[limited-auction] case ${caseId} approved by ${admin.email} with ${sourcingCase.coverageCount} rooftops`,
  );

  return adminSuccess({
    caseId,
    status: SOURCING_CASE_STATUS.READY_TO_LAUNCH,
    readyCount: sourcingCase.coverageCount,
    message:
      "Approved. The auction will launch on the next readiness pass, once every §7 entry item is green.",
  });
}
