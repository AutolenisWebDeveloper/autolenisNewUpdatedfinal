// POST /api/public/request-vehicle
//
// Public buyer vehicle-request submission. The form has six sections:
//   1. contact info, 2. vehicle preferences, 3. budget + financing path,
//   4a. need-financing profile  OR  4b. have-financing pre-approval (with
//   optional uploaded letter), 5. trade-in details, 6. notes + consent.
//
// Submissions are persisted as a `Notification` row with `type: SYSTEM_ALERT`
// and a title prefix of `Vehicle Request:` so they show up on the new
// `/admin/vehicle-requests` queue page. Best-effort emails go out to the
// admin and a confirmation to the buyer.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendVehicleRequestAdminNotification,
  sendVehicleRequestConfirmation,
} from "@/lib/services/email/vehicle-offers.email";
import {
  sendVehicleRequestReceived,
  sendDealerNewBuyerOpportunityEmail,
} from "@/lib/services/email/resend.service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const schema = z.object({
  firstName:           z.string().min(1).max(50),
  lastName:            z.string().min(1).max(50),
  email:               z.string().email(),
  phone:               z.string().min(7).max(20),
  zip:                 z.string().regex(/^\d{5}$/, "ZIP must be 5 digits"),
  city:                z.string().min(1).max(100),
  state:               z.string().min(2).max(50),
  contactMethod:       z.enum(["Phone Call", "Text Message", "Email"]),
  timeline:            z.enum(["ASAP", "Within 30 Days", "Within 60 Days", "Just Researching"]),
  vehicleType:         z.enum(["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"]),
  preferredMake:       z.string().max(50).optional(),
  preferredModel:      z.string().max(80).optional(),
  customMakeModel:     z.string().max(100).optional(),
  minYear:             z.number().int().min(2000).max(2030).optional(),
  maxYear:             z.number().int().min(2000).max(2030).optional(),
  newOrUsed:           z.enum(["New", "Used", "Either"]),
  specificFeatures:    z.string().max(500).optional(),
  interiorColor:       z.string().max(100).optional(),
  mustHaveFeatures:    z.string().max(1000).optional(),
  openToAlternatives:  z.boolean(),
  budget:              z.string().min(1).max(100),
  desiredMonthly:      z.string().max(50).optional(),
  downPaymentAvail:    z.string().max(50).optional(),
  financingOption:     z.enum(["need_financing", "have_financing", "no_financing"]),
  employmentStatus:    z.string().max(50).optional(),
  employerName:        z.string().max(100).optional(),
  annualIncome:        z.string().max(50).optional(),
  creditScore:         z.string().max(50).optional(),
  downPayment:         z.string().max(50).optional(),
  monthlyPayment:      z.string().max(50).optional(),
  monthlyIncome:       z.string().max(50).optional(),
  housingPayment:      z.string().max(50).optional(),
  coBuyer:             z.boolean().optional(),
  lenderName:          z.string().max(100).optional(),
  approvedAmount:      z.string().max(20).optional(),
  apr:                 z.string().max(10).optional(),
  preApprovalExpiry:   z.string().max(20).optional(),
  hasTradeIn:          z.boolean().optional(),
  tradeYear:           z.string().max(10).optional(),
  tradeMake:           z.string().max(50).optional(),
  tradeModel:          z.string().max(80).optional(),
  tradeTrim:           z.string().max(50).optional(),
  tradeMileage:        z.string().max(20).optional(),
  tradeColor:          z.string().max(30).optional(),
  tradeCondition:      z.string().max(20).optional(),
  tradeVin:            z.string().max(17).optional(),
  tradePaidOff:        z.boolean().optional(),
  tradeLoanBalance:    z.string().max(20).optional(),
  tradePayoffAmount:   z.string().max(20).optional(),
  tradeIssues:         z.string().max(1000).optional(),
  tradeTitleStatus:    z.string().max(30).optional(),
  tradeAccidentHistory: z.string().max(60).optional(),
  notes:               z.string().max(1000).optional(),
  agreedToContact:     z.literal(true),
});

type Parsed = z.infer<typeof schema>;

async function uploadPreApproval(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_FILE_BYTES) return null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key);
    const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const path = `public-requests/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const buffer = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("prequal-letters")
      .upload(path, buffer, { contentType: file.type });
    if (upErr) {
      console.error("[request-vehicle] supabase upload error:", upErr);
      return null;
    }
    return supabase.storage.from("prequal-letters").getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.error("[request-vehicle] upload exception:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  let raw: unknown;
  let preApprovalFileUrl: string | null = null;

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
      raw = typeof dataField === "string" ? JSON.parse(dataField) : null;
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid data payload" } },
        { status: 400 },
      );
    }
    const file = fd.get("preApprovalFile");
    if (file instanceof File && file.size > 0) {
      preApprovalFileUrl = await uploadPreApproval(file);
    }
  } else {
    try { raw = await request.json(); } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
        { status: 400 },
      );
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }
  const data: Parsed = parsed.data;

  const fullName = `${data.firstName} ${data.lastName}`.trim();

  // Persist as a SYSTEM_ALERT with the standardised "Vehicle Request:" title
  // prefix that /admin/vehicle-requests filters on.
  let notificationId: string | undefined;
  try {
    const created = await prisma.notification.create({
      data: {
        type: "SYSTEM_ALERT",
        channel: "IN_APP",
        title: `Vehicle Request: ${fullName}`,
        body: `${data.vehicleType} · ${data.budget} · ${data.financingOption} · ${data.city}, ${data.state} ${data.zip}`,
        actionUrl: "/admin/vehicle-requests",
        metadata: {
          ...data,
          fullName,
          requestStatus: "new",
          preApprovalFileUrl,
        } as unknown as Parameters<typeof prisma.notification.create>[0]["data"]["metadata"],
      },
    });
    notificationId = created.id;
  } catch (err) {
    console.error("[request-vehicle] notification persist failed:", err);
  }

  await Promise.allSettled([
    sendVehicleRequestAdminNotification({
      fullName,
      email: data.email,
      phone: data.phone,
      zip: data.zip,
      city: data.city,
      state: data.state,
      vehicleType: data.vehicleType,
      preferredMake: data.preferredMake,
      preferredModel: data.preferredModel,
      minYear: data.minYear,
      maxYear: data.maxYear,
      budget: data.budget,
      newOrUsed: data.newOrUsed,
      financingNeeded:
        data.financingOption === "need_financing" ? "Yes" :
        data.financingOption === "have_financing" ? "No" :
        "Not Sure",
      contactMethod: data.contactMethod,
      timeline: data.timeline,
      interiorColor: data.interiorColor,
      mustHaveFeatures: data.mustHaveFeatures,
      openToAlternatives: data.openToAlternatives,
      desiredMonthly: data.desiredMonthly,
      downPaymentAvail: data.downPaymentAvail,
      hasTradeIn: data.hasTradeIn,
      tradeYear: data.tradeYear,
      tradeMake: data.tradeMake,
      tradeModel: data.tradeModel,
      notes: data.notes,
      notificationId,
    }),
    sendVehicleRequestConfirmation(data.email, data.firstName),
  ]);

  // Buyer-side dedicated confirmation (uses unified resend template).
  if (notificationId) {
    await sendVehicleRequestReceived(data.email, fullName, notificationId)
      .catch(err => console.error("[request-vehicle] buyer confirmation email failed:", err));
  }

  // Notify active dealers of the new buyer opportunity — non-blocking per dealer.
  if (notificationId) {
    const vehicleInterest = [
      data.preferredMake,
      data.preferredModel,
      data.customMakeModel,
    ].filter(Boolean).join(" ") || data.vehicleType;
    const activeDealers = await prisma.dealer.findMany({
      where: { status: "ACTIVE" },
      include: { user: { select: { email: true } } },
      take: 20,
    }).catch(() => [] as Array<{ id: string; dealershipName: string; user: { email: string } | null }>);
    for (const dealer of activeDealers) {
      if (!dealer.user?.email) continue;
      await sendDealerNewBuyerOpportunityEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        vehicleInterest,
        buyerCity: data.city,
        buyerState: data.state,
        opportunityUrl: `${APP_URL}/dealer/opportunities`,
        opportunityId: notificationId,
      }).catch(() => { /* silent per-dealer */ });
    }
  }

  return NextResponse.json({ success: true });
}
