// POST /api/admin/vehicle-offers/[id]/send-to-buyer — package selected dealer
// vehicle offers into a BuyerOfferReview with one item per (submission, vehicle).
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { sendBuyerOfferReviewEmail } from "@/lib/services/email/vehicle-offers.email";
import { sendVehicleOfferReady } from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

const itemSchema = z.object({
  submissionId: z.string().min(1),
  vehicleIndex: z.number().int().min(0),
});

const schema = z.object({
  buyerName:    z.string().min(1).max(100),
  buyerEmail:   z.string().email(),
  adminMessage: z.string().max(2000).optional(),
  items:        z.array(itemSchema).min(1),
});

interface Params { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  const { id } = await params;

  const offer = await prisma.vehicleOffer.findUnique({
    where: { id },
    include: { submissions: true },
  });
  if (!offer) return adminError("NOT_FOUND", "Vehicle offer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const data = parsed.data;

  // Validate every selected item refers to a real, non-rejected submission for this offer
  const submissionMap = new Map(offer.submissions.map((s) => [s.id, s] as const));
  for (const item of data.items) {
    const sub = submissionMap.get(item.submissionId);
    if (!sub) {
      return adminError("INVALID_SELECTION", "Selected submission not part of this offer", 400);
    }
    if (sub.rejected) {
      return adminError("INVALID_SELECTION", "Cannot send a rejected submission to the buyer", 400);
    }
  }

  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.buyerOfferReview.create({
      data: {
        vehicleOfferId: offer.id,
        buyerEmail: data.buyerEmail,
        buyerName: data.buyerName,
        adminMessage: data.adminMessage ?? null,
      },
    });
    await tx.buyerOfferReviewItem.createMany({
      data: data.items.map((item) => ({
        buyerOfferReviewId: r.id,
        dealerSubmissionId: item.submissionId,
        vehicleIndex: item.vehicleIndex,
      })),
    });
    return r;
  });

  const reviewUrl = `${APP_URL}/buyer-offer-review/${review.reviewToken}`;

  // If the buyer already has a User+Buyer account, drop a notification into
  // their in-app inbox so the review surfaces in the authenticated dashboard
  // alongside the email. Failures here must not break the admin response.
  try {
    const buyerUser = await prisma.user.findFirst({
      where: { email: data.buyerEmail.toLowerCase() },
      select: { id: true },
    });
    if (buyerUser) {
      const buyer = await prisma.buyer.findFirst({
        where: { userId: buyerUser.id },
        select: { id: true },
      });
      if (buyer) {
        await prisma.notification.create({
          data: {
            buyerId: buyer.id,
            type: "SYSTEM_ALERT",
            channel: "IN_APP",
            title: "You have vehicle offers to review",
            body: `AutoLenis found ${data.items.length} vehicle offer${data.items.length !== 1 ? "s" : ""} matching your request. Click to review.`,
            actionUrl: `/buyer-offer-review/${review.reviewToken}`,
          },
        });
      }
    }
  } catch (err) {
    console.error("[send-to-buyer] in-app notification failed:", err);
  }

  try {
    await sendBuyerOfferReviewEmail({
      to: data.buyerEmail,
      buyerName: data.buyerName,
      reviewToken: review.reviewToken,
      itemCount: data.items.length,
      adminMessage: data.adminMessage,
    });
  } catch (err) {
    console.error("[send-to-buyer] email failed:", err);
  }

  // Dedicated "your vehicle offer is ready" buyer email — non-blocking.
  await sendVehicleOfferReady(data.buyerEmail, data.buyerName, review.id)
    .catch(err => console.error("[send-to-buyer] vehicle offer ready email failed:", err));

  await prisma.vehicleOffer.update({
    where: { id: offer.id },
    data: { requestStatus: "sent_to_buyer" },
  }).catch((err) => console.error("[send-to-buyer] requestStatus update failed:", err));

  return adminSuccess({ reviewToken: review.reviewToken, reviewUrl }, 201);
}
