// POST /api/public/dealer-application — creates DealerApplication record, sends confirmation emails

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendDealerApplicationReceived,
  sendDealerApplicationAdminNotification,
} from "@/lib/services/email/resend.service";

const schema = z.object({
  dealershipName: z.string().min(1),
  // dealershipType is optional — older forms (e.g. /dealer/apply) omit it;
  // it defaults to "Independent" when not supplied.
  dealershipType: z.string().min(1).optional().default("Independent"),
  state: z.string().length(2),
  city: z.string().min(1),
  zip: z.string().min(5),
  licenseNumber: z.string().min(1),
  contactName: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  annualVolume: z.string().optional(),
  // streetAddress is accepted and appended to notes for backwards compatibility
  streetAddress: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON" }, correlationId: crypto.randomUUID() }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" }, correlationId: crypto.randomUUID() }, { status: 400 });
  }

  const data = parsed.data;

  // Merge streetAddress into notes if provided (legacy /dealer/apply form sends it)
  const mergedNotes = [
    data.streetAddress ? `Address: ${data.streetAddress}` : "",
    data.notes ?? "",
  ].filter(Boolean).join("\n") || null;

  // Check for duplicate pending/approved application from same email
  const existing = await prisma.dealerApplication.findFirst({
    where: {
      contactEmail: data.contactEmail.toLowerCase(),
      status: { in: ["PENDING", "APPROVED"] },
    },
  });
  if (existing) {
    return NextResponse.json({
      error: { code: "DUPLICATE_APPLICATION", message: "An application for this email is already under review." },
      correlationId: crypto.randomUUID(),
    }, { status: 409 });
  }

  const application = await prisma.dealerApplication.create({
    data: {
      dealershipName: data.dealershipName,
      dealershipType: data.dealershipType ?? "Independent",
      state: data.state,
      city: data.city,
      zip: data.zip,
      licenseNumber: data.licenseNumber,
      contactName: data.contactName,
      contactEmail: data.contactEmail.toLowerCase(),
      contactPhone: data.contactPhone ?? null,
      annualVolume: data.annualVolume ?? null,
      notes: mergedNotes,
      status: "PENDING",
    },
  });

  // Send confirmation to dealer and notification to admin (fire and forget)
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? "admin@autolenis.com";
  const [dealerResult, adminResult] = await Promise.allSettled([
    sendDealerApplicationReceived(data.contactEmail, data.contactName, data.dealershipName),
    sendDealerApplicationAdminNotification(adminEmail, {
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      dealershipName: data.dealershipName,
      state: data.state,
      appId: application.id,
    }),
  ]);
  if (dealerResult.status === "rejected") {
    console.error("[dealer-application] dealer email failed:", dealerResult.reason);
  }
  if (adminResult.status === "rejected") {
    console.error("[dealer-application] admin email failed:", adminResult.reason);
  }

  return NextResponse.json({
    success: true,
    data: {
      applicationId: application.id,
      message: "Application received. Our team will review within 2 business days.",
    },
  }, { status: 201 });
}
