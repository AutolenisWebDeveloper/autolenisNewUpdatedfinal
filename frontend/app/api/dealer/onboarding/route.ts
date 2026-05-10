// PATCH /api/dealer/onboarding — save onboarding step data, set ACTIVE on final step
// GET   /api/dealer/onboarding — return current persisted onboarding values for hydration

import { NextRequest, NextResponse } from "next/server";
import { requireDealerFromRequest } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const dealer = await requireDealerFromRequest(request);
  if (!dealer) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const d = await prisma.dealer.findUnique({
    where: { id: dealer.id },
    select: {
      status: true,
      dealershipName: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      licenseNumber: true,
      onboardingStep: true,
      agreedToTermsAt: true,
    },
  });

  if (!d) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Dealer not found" } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: d });
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
] as const;

const businessSchema = z.object({
  step: z.literal("BUSINESS_INFO"),
  dealershipName: z.string().min(1),
  phone: z.string().min(7),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.enum(US_STATES, { errorMap: () => ({ message: "Invalid US state code" }) }),
  zip: z.string().min(5),
});

const licenseSchema = z.object({
  step: z.literal("LICENSE"),
  licenseNumber: z.string().min(1),
});

const inventorySchema = z.object({
  step: z.literal("INVENTORY"),
  // optional feed URL — can be empty
  feedUrl: z.string().url().optional().or(z.literal("")),
});

const agreementSchema = z.object({
  step: z.literal("AGREEMENT"),
  agreedToTerms: z.literal(true),
});

const bodySchema = z.discriminatedUnion("step", [
  businessSchema,
  licenseSchema,
  inventorySchema,
  agreementSchema,
]);

export async function PATCH(request: NextRequest) {
  const dealer = await requireDealerFromRequest(request);
  if (!dealer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const data = parsed.data;

  if (data.step === "BUSINESS_INFO") {
    await prisma.dealer.update({
      where: { id: dealer.id },
      data: {
        dealershipName: data.dealershipName,
        phone: data.phone,
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        onboardingStep: "LICENSE",
      },
    });
    return NextResponse.json({ success: true, nextStep: "LICENSE" });
  }

  if (data.step === "LICENSE") {
    await prisma.dealer.update({
      where: { id: dealer.id },
      data: { licenseNumber: data.licenseNumber, onboardingStep: "INVENTORY" },
    });
    return NextResponse.json({ success: true, nextStep: "INVENTORY" });
  }

  if (data.step === "INVENTORY") {
    // Optional feed setup
    if (data.feedUrl) {
      await prisma.dealerFeedConfig.upsert({
        where: { dealerId: dealer.id },
        create: {
          dealerId: dealer.id,
          feedUrl: data.feedUrl,
          format: "JSON",
          refreshIntervalHours: 24,
          isActive: true,
        },
        update: { feedUrl: data.feedUrl, isActive: true },
      });
    }
    await prisma.dealer.update({
      where: { id: dealer.id },
      data: { onboardingStep: "AGREEMENT" },
    });
    return NextResponse.json({ success: true, nextStep: "AGREEMENT" });
  }

  if (data.step === "AGREEMENT") {
    const updatedDealer = await prisma.dealer.update({
      where: { id: dealer.id },
      data: {
        agreedToTermsAt: new Date(),
        onboardingStep: "COMPLETE",
        status: "ACTIVE",
      },
      include: { user: { select: { email: true } } },
    });

    // Fire-and-forget: send the DocuSign marketplace agreement envelope.
    // Failures here must never block onboarding completion — the dealer is
    // already ACTIVE and can retry from the dashboard if anything went wrong.
    const { sendDealerMarketplaceAgreement } = await import(
      "@/lib/services/esign/dealer-marketplace-agreement.service"
    );
    void sendDealerMarketplaceAgreement({
      dealerId: updatedDealer.id,
      email: updatedDealer.user?.email ?? "",
      name: updatedDealer.dealershipName ?? "Dealer",
    }).catch((err) => {
      console.error("[dealer-onboarding/agreement] DocuSign send failed:", err);
    });

    return NextResponse.json({ success: true, nextStep: "COMPLETE", redirect: "/dealer/dashboard" });
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
