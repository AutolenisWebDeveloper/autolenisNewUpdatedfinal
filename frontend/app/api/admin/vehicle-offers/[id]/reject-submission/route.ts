// POST /api/admin/vehicle-offers/[id]/reject-submission
// Marks an individual DealerOfferSubmission as rejected and notifies the dealer.
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { sendDealerAcceptanceNotification } from "@/lib/services/email/vehicle-offers.email";

const schema = z.object({
  submissionId: z.string().min(1),
});

interface Params { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const submission = await prisma.dealerOfferSubmission.findUnique({
    where: { id: parsed.data.submissionId },
    include: { vehicleOffer: true },
  });
  if (!submission || submission.vehicleOfferId !== id) {
    return adminError("NOT_FOUND", "Submission not found for this offer", 404);
  }

  await prisma.dealerOfferSubmission.update({
    where: { id: submission.id },
    data: { rejected: true, rejectedAt: new Date() },
  });

  // Best-effort email — using the existing dealer notification helper for now;
  // in production you'd want a dedicated "offer not selected" template.
  await sendDealerAcceptanceNotification({
    to: submission.contactEmail,
    contactName: submission.contactName,
    buyerName: "AutoLenis",
    vehicleLabel: `${submission.vehicleOffer.vehicleYear} ${submission.vehicleOffer.vehicleMake} ${submission.vehicleOffer.vehicleModel} — Offer not selected`,
  }).catch((err) => console.error("[reject-submission] dealer email failed:", err));

  return adminSuccess({ id: submission.id, rejected: true });
}
