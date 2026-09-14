// POST /api/public/dealer-offer/[token] — public dealer submission endpoint.
//
// The token can be either a per-dealer VehicleOfferDealerInvite token (from the
// invite email flow) or a generic VehicleOffer token (from the shareable link).
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendDealerOfferAdminNotification,
  sendDealerOfferConfirmation,
} from "@/lib/services/email/vehicle-offers.email";

const DOCS_BUCKET    = "dealer-offer-docs";
const MAX_DOC_BYTES  = 20 * 1024 * 1024;
const MAX_DOC_COUNT  = 5;
const ALLOWED_DOC_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

async function uploadDealerDoc(
  file: File,
  submissionId: string,
  index: number,
): Promise<{ url: string; name: string; type: string; sizeBytes: number } | null> {
  if (!ALLOWED_DOC_TYPES.includes(file.type)) return null;
  if (file.size > MAX_DOC_BYTES) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    logger.error("[dealer-offer] Supabase env vars missing for upload");
    return null;
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b) => b.name === DOCS_BUCKET)) {
      await supabase.storage.createBucket(DOCS_BUCKET, { public: true });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const path     = `${submissionId}/${index}-${Date.now()}-${safeName}`;
    const buffer   = await file.arrayBuffer();

    const { error } = await supabase.storage
      .from(DOCS_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (error) {
      logger.error("[dealer-offer] upload error:", error);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(DOCS_BUCKET)
      .getPublicUrl(path);

    return { url: publicUrl, name: file.name, type: file.type, sizeBytes: file.size };
  } catch (err) {
    logger.error("[dealer-offer] upload exception:", err);
    return null;
  }
}

const vehicleSchema = z.object({
  vehicleUrl:         z.string().url(),
  stockNumber:        z.string().min(1).max(50),
  vin:                z.string().length(17),
  year:               z.number().int().min(2000).max(2030),
  make:               z.string().min(1).max(50),
  model:              z.string().min(1).max(80),
  trim:               z.string().max(50).optional(),
  mileage:            z.number().int().min(0).optional(),
  color:              z.string().max(50).optional(),
  interiorColor:      z.string().max(50).optional(),
  condition:          z.enum(["New", "Used", "Certified Pre-Owned"]),
  offerPriceCents:    z.number().int().min(1),
  tradeInAccepted:    z.boolean(),
  financingAvailable: z.boolean(),
  warrantyIncluded:   z.boolean(),
  warrantyDetails:    z.string().max(500).optional(),
  windowStickerUrl:   z.string().url().optional(),
  carfaxUrl:          z.string().url().optional(),
  availability:       z.enum(["In Stock Now", "Within 3 Days", "Within 1 Week", "Within 2 Weeks"]),
});

const schema = z.object({
  dealershipName:    z.string().min(1).max(150),
  contactName:       z.string().min(1).max(100),
  contactEmail:      z.string().email(),
  contactPhone:      z.string().min(7).max(40),
  vehicles:          z.array(vehicleSchema).min(1).max(3),
  notes:             z.string().max(1000).optional(),
  finderFeeAgreed:   z.literal(true),
  confirmedAccuracy: z.literal(true),
});

interface Params { params: Promise<{ token: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { token } = await params;

  // Look up either invite or generic offer
  const invite = await prisma.vehicleOfferDealerInvite.findUnique({
    where: { token },
    include: { vehicleOffer: true },
  });

  let offer = invite?.vehicleOffer ?? null;
  if (!offer) {
    offer = await prisma.vehicleOffer.findUnique({ where: { token } });
  }
  if (!offer) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Offer link not found" } },
      { status: 404 },
    );
  }

  const effectiveExpiry = invite?.expiresAt ?? offer.expiresAt;
  if (effectiveExpiry && effectiveExpiry < new Date()) {
    return NextResponse.json(
      { success: false, error: { code: "EXPIRED", message: "This offer link has expired." } },
      { status: 410 },
    );
  }

  // ── Parse request body (multipart with files OR plain JSON) ──────────────
  let body: unknown;
  const pendingDocFiles: File[] = [];

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let fd: FormData;
    try { fd = await request.formData(); } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid form data" } },
        { status: 400 },
      );
    }
    const dataField = fd.get("data");
    try {
      body = typeof dataField === "string" ? JSON.parse(dataField) : null;
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid data payload" } },
        { status: 400 },
      );
    }
    for (let i = 0; i < MAX_DOC_COUNT; i++) {
      const f = fd.get(`doc${i}`);
      if (f instanceof File && f.size > 0) pendingDocFiles.push(f);
    }
  } else {
    try { body = await request.json(); } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
        { status: 400 },
      );
    }
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // ── "SUBMIT ANOTHER OFFER", WHICH THE INVITE-TOKEN FIX BROKE ───────────────────────────────
  //
  // `dealer_offer_submissions.invite_id` is `@unique`. Before the authorized security fix the form
  // POSTed the SHARED `VehicleOffer` token, so `invite` was always null here and the column was
  // never written — a second submission was simply a second row. Carrying the per-dealer invite
  // token (which is what stopped the confirmation page showing a competitor's bid) means the first
  // submission now claims that column, and the confirmation page's own "Submit Another Offer" link
  // — an invite-token URL — walked straight into a unique violation: an unhandled P2002, a 500,
  // and a dealership that lost the work it had just typed with no way to succeed.
  //
  // The invite's OWN `submission_id` is re-pointed to the newest submission a few statements below
  // and has always been re-pointable. Moving `invite_id` in the same transaction makes the two
  // columns name the SAME row instead of leaving one stranded on the first submission. No
  // submission is deleted or overwritten: an earlier one keeps its vehicles, documents, dealership
  // name and contact details, and its `vehicle_offer_id` — it is simply no longer THE submission
  // this invite resolves to, which is exactly what `submission_id` already said.
  const submission = await prisma.$transaction(async (tx) => {
    if (invite) {
      await tx.dealerOfferSubmission.updateMany({
        where: { inviteId: invite.id },
        data:  { inviteId: null },
      });
    }
    return tx.dealerOfferSubmission.create({
      data: {
        vehicleOfferId: offer.id,
        dealershipName: data.dealershipName,
        contactName:    data.contactName,
        contactEmail:   data.contactEmail.toLowerCase(),
        contactPhone:   data.contactPhone,
        vehicles:       data.vehicles as unknown as Parameters<typeof prisma.dealerOfferSubmission.create>[0]["data"]["vehicles"],
        notes:          data.notes ?? null,
        inviteId:       invite?.id ?? null,
      },
    });
  });

  // ── Upload documents now that submission.id is available ────────────────
  const uploadedDocs: Array<{ url: string; name: string; type: string; sizeBytes: number }> = [];

  if (pendingDocFiles.length > 0) {
    const results = await Promise.allSettled(
      pendingDocFiles.slice(0, MAX_DOC_COUNT).map((file, i) =>
        uploadDealerDoc(file, submission.id, i),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) uploadedDocs.push(r.value);
    }
    if (uploadedDocs.length > 0) {
      await prisma.dealerOfferSubmission.update({
        where: { id: submission.id },
        data: {
          documents: uploadedDocs as unknown as
            Parameters<typeof prisma.dealerOfferSubmission.update>[0]["data"]["documents"],
        },
      }).catch((err) => logger.error("[dealer-offer] documents update failed:", err));
    }
  }

  // ── Link to registered dealer if email matches ──────────────────────────
  // If contactEmail matches a registered Dealer account, link the submission
  // so the dealer can see it in their portal alongside auction offers.
  const registeredDealer = await prisma.dealer.findFirst({
    where:  { user: { email: data.contactEmail.toLowerCase() } },
    select: { id: true },
  }).catch(() => null);

  if (registeredDealer) {
    await prisma.dealerOfferSubmission.update({
      where: { id: submission.id },
      data:  { dealerId: registeredDealer.id },
    }).catch(err =>
      logger.error("[dealer-offer] dealer linkage update failed:", err)
    );
  }

  // Mark invite submitted (if applicable) + bump offer status to offers_in
  if (invite) {
    await prisma.vehicleOfferDealerInvite.update({
      where: { id: invite.id },
      data: { status: "submitted", submittedAt: new Date(), submissionId: submission.id },
    }).catch((err) => logger.error("[dealer-offer] invite status update failed:", err));
  }

  await prisma.vehicleOffer.update({
    where: { id: offer.id },
    data: { requestStatus: "offers_in" },
  }).catch((err) => logger.error("[dealer-offer] offer status update failed:", err));

  const vehicleOfferLabel = `${offer.vehicleYear} ${offer.vehicleMake} ${offer.vehicleModel}${offer.vehicleTrim ? ` ${offer.vehicleTrim}` : ""}`;

  await Promise.allSettled([
    sendDealerOfferAdminNotification({
      offerId:           offer.id,
      vehicleOfferLabel,
      dealershipName:    data.dealershipName,
      contactName:       data.contactName,
      contactEmail:      data.contactEmail,
      contactPhone:      data.contactPhone,
      vehicles:          data.vehicles,
      notes:             data.notes,
      documentUrls:      uploadedDocs.map((d) => d.url),
      documentNames:     uploadedDocs.map((d) => d.name),
    }),
    sendDealerOfferConfirmation({
      to:                data.contactEmail,
      contactName:       data.contactName,
      dealershipName:    data.dealershipName,
      vehicleOfferLabel,
    }),
  ]);

  return NextResponse.json({ success: true });
}
