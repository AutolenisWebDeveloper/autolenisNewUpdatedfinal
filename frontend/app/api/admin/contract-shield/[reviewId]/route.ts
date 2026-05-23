// POST /api/admin/contract-shield/[reviewId]
// Admin review actions on a Contract Shield scan: APPROVE | FLAG | REQUEST_REVISION.
// reviewId is the ContractScan id. Every action is audit-logged and fires the
// correct buyer/dealer notifications.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createEnvelope } from "@/lib/services/esign/esign.service";
import {
  sendContractApprovedEmail,
  sendContractShieldAlertEmail,
  sendDealerContractIssuesEmail,
} from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

interface Props { params: Promise<{ reviewId: string }> }

type ChangeLogEntry = { action: string; admin: string; reason: string | null; at: string };

function appendChangeLog(existing: Prisma.JsonValue | null, entry: ChangeLogEntry): Prisma.InputJsonValue {
  const arr = Array.isArray(existing) ? (existing as unknown[]) : [];
  return [...arr, entry] as unknown as Prisma.InputJsonValue;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { reviewId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const { action, reason, issues } = await request.json().catch(() => ({})) as {
    action?: string; reason?: string; issues?: string[];
  };

  const scan = await prisma.contractScan.findUnique({
    where: { id: reviewId },
    include: {
      deal: {
        include: {
          buyer: { include: { user: { select: { email: true } } } },
          offer: { include: { dealer: { include: { user: { select: { email: true } } } } } },
        },
      },
    },
  });
  if (!scan) return adminError("NOT_FOUND", "Contract review not found", 404);

  const deal = scan.deal;
  const buyerEmail = deal.buyer.user?.email ?? null;
  const buyerFirstName = deal.buyer.firstName ?? "there";
  const buyerName = `${deal.buyer.firstName ?? ""} ${deal.buyer.lastName ?? ""}`.trim() || "Buyer";
  const dealer = deal.offer?.dealer ?? null;
  const dealerEmail = dealer?.user?.email ?? null;
  const vehicleRef = `Deal ${deal.id.slice(0, 8)}`;
  const contractUrl = `${APP_URL}/dealer/deals/${deal.id}`;
  const logEntry = (label: string): ChangeLogEntry => ({
    action: label, admin: admin.email, reason: reason ?? null, at: new Date().toISOString(),
  });

  let result: Record<string, unknown> = {};

  switch (action) {
    case "APPROVE": {
      await prisma.contractScan.update({
        where: { id: reviewId },
        data: { status: "PASS", changeLog: appendChangeLog(scan.changeLog, logEntry("APPROVED")) },
      });
      await prisma.deal.update({
        where: { id: deal.id },
        data: { contractShieldStatus: "PASS", contractShieldScore: scan.score, status: "CONTRACT_APPROVED" },
      });

      // Trigger the DocuSign envelope to the buyer (mock-safe when DocuSign unconfigured).
      let envelopeId: string | null = null;
      if (buyerEmail) {
        const envelope = await createEnvelope(deal.id, buyerEmail, buyerName)
          .catch(err => { console.error("[contract-shield] createEnvelope failed:", err); return null; });
        envelopeId = envelope?.envelopeId ?? null;
      }

      await prisma.notification.create({
        data: {
          buyerId: deal.buyerId,
          type: "CONTRACT_APPROVED",
          title: "Contract approved",
          body: "Your purchase agreement passed review. Your signing link is ready.",
          actionUrl: `/buyer/deal/${deal.id}/sign`,
        },
      }).catch(() => {});
      if (buyerEmail) {
        await sendContractApprovedEmail({ to: buyerEmail, firstName: buyerFirstName, dealId: deal.id })
          .catch(err => console.error("[contract-shield] buyer approved email failed:", err));
      }
      if (dealer) {
        await prisma.notification.create({
          data: {
            dealerId: dealer.id,
            type: "CONTRACT_APPROVED",
            channel: "IN_APP",
            title: "Contract approved",
            body: `Your agreement for ${vehicleRef} was approved by AutoLenis and sent to the buyer for signing.`,
          },
        }).catch(() => {});
      }

      result = { approved: true, envelopeId };
      break;
    }

    case "FLAG": {
      const flaggedIssues = (issues ?? []).map(s => s.trim()).filter(Boolean);
      if (flaggedIssues.length === 0) {
        return adminError("ISSUES_REQUIRED", "At least one issue is required to flag a contract", 400);
      }
      await prisma.contractScan.update({
        where: { id: reviewId },
        data: {
          status: "FLAGGED",
          fixList: flaggedIssues as unknown as Prisma.InputJsonValue,
          changeLog: appendChangeLog(scan.changeLog, logEntry("FLAGGED")),
        },
      });
      // Flag does not advance or regress the deal stage — only records the status.
      await prisma.deal.update({
        where: { id: deal.id },
        data: { contractShieldStatus: "FLAGGED" },
      });

      await prisma.notification.create({
        data: {
          buyerId: deal.buyerId,
          type: "ADMIN_MESSAGE",
          title: "Contract flagged for review",
          body: `We flagged ${flaggedIssues.length} issue${flaggedIssues.length !== 1 ? "s" : ""} on your contract: ${flaggedIssues.join("; ")}`,
        },
      }).catch(() => {});
      if (buyerEmail) {
        await sendContractShieldAlertEmail({ to: buyerEmail, firstName: buyerFirstName, dealId: deal.id, issueCount: flaggedIssues.length })
          .catch(err => console.error("[contract-shield] buyer flag email failed:", err));
      }
      if (dealerEmail) {
        await sendDealerContractIssuesEmail({
          to: dealerEmail, contactName: dealer?.dealershipName ?? "Dealer",
          vehicleRef, fixItems: flaggedIssues, contractUrl, dealId: deal.id,
        }).catch(err => console.error("[contract-shield] dealer flag email failed:", err));
      }
      if (dealer) {
        await prisma.notification.create({
          data: {
            dealerId: dealer.id,
            type: "ADMIN_MESSAGE",
            channel: "IN_APP",
            title: "Contract flagged",
            body: `Issues flagged on ${vehicleRef}: ${flaggedIssues.join("; ")}`,
          },
        }).catch(() => {});
      }

      result = { flagged: true, issues: flaggedIssues };
      break;
    }

    case "REQUEST_REVISION": {
      if (!reason?.trim()) {
        return adminError("REASON_REQUIRED", "A reason is required to request a revision", 400);
      }
      await prisma.contractScan.update({
        where: { id: reviewId },
        data: { status: "REVISION_REQUESTED", changeLog: appendChangeLog(scan.changeLog, logEntry("REVISION_REQUESTED")) },
      });
      // Send the deal back to the dealer for a corrected upload.
      await prisma.deal.update({
        where: { id: deal.id },
        data: { contractShieldStatus: "REVISION_REQUESTED", status: "CONTRACT_PENDING" },
      });

      if (dealerEmail) {
        await sendDealerContractIssuesEmail({
          to: dealerEmail, contactName: dealer?.dealershipName ?? "Dealer",
          vehicleRef, fixItems: [reason], contractUrl, dealId: deal.id,
        }).catch(err => console.error("[contract-shield] dealer revision email failed:", err));
      }
      if (dealer) {
        await prisma.notification.create({
          data: {
            dealerId: dealer.id,
            type: "CONTRACT_READY",
            channel: "IN_APP",
            title: "Revision required",
            body: `A revision is required for ${vehicleRef}: ${reason}`,
          },
        }).catch(() => {});
      }
      await prisma.notification.create({
        data: {
          buyerId: deal.buyerId,
          type: "ADMIN_MESSAGE",
          title: "Contract under review",
          body: "AutoLenis is reviewing your contract — a minor revision was requested from the dealer. We'll update you shortly.",
        },
      }).catch(() => {});

      result = { revisionRequested: true };
      break;
    }

    default:
      return adminError("UNKNOWN_ACTION", "Unknown action — expected APPROVE, FLAG, or REQUEST_REVISION", 400);
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: `CONTRACT_SHIELD_${action}`,
      entityType: "ContractScan",
      entityId: reviewId,
      reason: reason ?? null,
      metadata: JSON.parse(JSON.stringify({ dealId: deal.id, ...result })),
    },
  });

  return adminSuccess(result);
}
