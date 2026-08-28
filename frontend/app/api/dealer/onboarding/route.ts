// PATCH /api/dealer/onboarding — save onboarding step data, set ACTIVE on final step
// GET   /api/dealer/onboarding — return current persisted onboarding values for hydration

import { NextRequest, NextResponse, after } from "next/server";
import { requireOnboardingDealerFromRequest } from "@/lib/auth/dealer-session";
import { signDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { emitDomainEvent } from "@/lib/events/emit";
import { recordDealerLicense } from "@/lib/services/dealer/dealer-verification.service";
import {
  recordDealerAgreementSignature,
  finalizeDealerAgreementCertificate,
} from "@/lib/services/agreement/dealer-agreement.service";

function clientAttribution(request: NextRequest): { ipAddress: string; userAgent: string } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return { ipAddress, userAgent };
}

export async function GET(request: NextRequest) {
  const dealer = await requireOnboardingDealerFromRequest(request);
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
  const dealer = await requireOnboardingDealerFromRequest(request);
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
    // Record a REAL DealerLicense + (pending) DealerVerification — the license
    // step no longer just stores free text and advances (FS-C).
    const current = await prisma.dealer.findUnique({ where: { id: dealer.id }, select: { state: true } });
    const recorded = await recordDealerLicense(dealer.id, data.licenseNumber, current?.state ?? null);
    if (!recorded.ok) {
      return NextResponse.json({ error: recorded.error ?? "Invalid license" }, { status: 422 });
    }
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
    // Idempotent: if onboarding is already complete, do not re-record the
    // signature or re-fire the signing envelope / activation event.
    if (dealer.onboardingStep === "COMPLETE") {
      return NextResponse.json({ success: true, nextStep: "COMPLETE", redirect: "/dealer/dashboard" });
    }

    const d = await prisma.dealer.findUnique({
      where: { id: dealer.id },
      select: { dealershipName: true, user: { select: { email: true } } },
    });
    const { ipAddress, userAgent } = clientAttribution(request);

    // Record a REAL, tamper-evident signature (SHA-256 + IP + UA) and complete
    // onboarding — never a bare "agreed" timestamp (FS-B). This is the shared
    // authority also used by /api/dealer/agreement/sign.
    const signature = await recordDealerAgreementSignature({
      dealerId: dealer.id,
      dealershipName: d?.dealershipName ?? "Dealer",
      signerEmail: d?.user?.email ?? "",
      ipAddress,
      userAgent,
    });

    // Certificate + confirmation email off the request path (must not throw).
    after(() => finalizeDealerAgreementCertificate({
      signatureId: signature.signatureId,
      dealerId: dealer.id,
      dealershipName: d?.dealershipName ?? "Dealer",
      signerEmail: d?.user?.email ?? "",
      ipAddress,
      userAgent,
      signedAt: signature.signedAt,
      agreementHash: signature.agreementHash,
    }));

    // ACTIVATION HAPPENS HERE, AND ONLY HERE.
    //
    // Admin approval of a DealerApplication grants permission to ONBOARD, not
    // portal access: all three dealer-creation paths leave the dealer PENDING
    // with an onboarding-scoped session. Signing the agreement is what earns
    // ACTIVE. (The previous comment here claimed the dealer was "typically
    // already ACTIVE from admin approval" — that was never true of any creation
    // path and is not true under the current model.)
    //
    // The verification GATE is still NOT here: it governs auction eligibility
    // (see dealer-auction-eligibility.service.ts), not portal activation.
    const updatedDealer = await prisma.dealer.update({
      where: { id: dealer.id },
      data: { status: "ACTIVE", onboardingStep: "COMPLETE" },
      include: { user: { select: { email: true } } },
    });

    // The dealer network agreement is signed in-house (DealerAgreementSignature,
    // recorded earlier in this route via recordDealerAgreementSignature). The
    // legacy DocuSign "belt-and-suspenders" marketplace envelope was removed.

    // CRM spine: onboarding complete → timeline + Make (non-blocking, never throws).
    if (updatedDealer.user?.email) {
      await emitDomainEvent("dealer_activated", {
        domainEntityId: updatedDealer.id,
        contact: { email: updatedDealer.user.email, firstName: updatedDealer.dealershipName ?? undefined, source: "dealer_signup" },
        data: { dealer_id: updatedDealer.id, dealership_name: updatedDealer.dealershipName },
      });
    }

    // The dealer is now ACTIVE, but their cookie still carries scope
    // "onboarding" — proxy.ts would keep bouncing them back here. Re-mint at
    // full scope on this same response so the very next request lands on the
    // dashboard. (The server-side gate already re-derives from Dealer.status,
    // so this is a routing correction, not a privilege grant.)
    const fullScopeToken = await signDealerJwt({
      dealerId: updatedDealer.id,
      userId: updatedDealer.userId,
      email: updatedDealer.user?.email ?? "",
      role: "DEALER",
      scope: "full",
    });

    const activatedResponse = NextResponse.json({
      success: true,
      nextStep: "COMPLETE",
      redirect: "/dealer/dashboard",
    });
    activatedResponse.cookies.set(DEALER_TOKEN_COOKIE, fullScopeToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return activatedResponse;
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
