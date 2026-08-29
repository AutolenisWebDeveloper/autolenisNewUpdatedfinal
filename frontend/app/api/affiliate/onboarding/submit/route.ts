import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import {
  getOnboardingProfile,
  computeOnboardingCompletion,
  saveOnboardingStep,
  OnboardingLockedError,
} from "@/lib/services/affiliate/onboarding.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const data       = await getOnboardingProfile(affiliate.id);
  const completion = computeOnboardingCompletion(data);

  if (!completion.isComplete) {
    const missing: string[] = [];
    if (!completion.steps.personalInfo)    missing.push("Personal information");
    if (!completion.steps.businessProfile) missing.push("Business profile");
    if (!completion.steps.taxInfo)         missing.push("Tax information (W-9)");
    if (!completion.steps.paymentProfile)  missing.push("Payment profile");
    if (!completion.steps.documents)       missing.push("Government ID document");
    return errorResponse("INCOMPLETE", `Missing: ${missing.join(", ")}`, 400);
  }

  // O3 — SUBMITTED is reachable only from IN_PROGRESS/NEEDS_CORRECTION; a
  // re-POST on an already-decided review can no longer erase the decision.
  try {
    await saveOnboardingStep(affiliate.id, 7, "SUBMITTED");
  } catch (err) {
    if (err instanceof OnboardingLockedError) {
      return errorResponse("ONBOARDING_LOCKED", `Your onboarding is already ${err.status.toLowerCase().replace("_", " ")}.`, 409);
    }
    throw err;
  }

  await prisma.notification.create({
    data: {
      affiliateId: affiliate.id,
      type:        "SYSTEM_ALERT",
      title:       "Onboarding submitted",
      body:        "Your onboarding information has been submitted for review. We'll notify you once it's been processed.",
      actionUrl:   "/affiliate/portal/profile",
    },
  }).catch(() => {});

  await prisma.adminAuditLog.create({
    data: {
      adminId:    "system",
      adminEmail: "system",
      action:     "AFFILIATE_ONBOARDING_SUBMITTED",
      entityType: "Affiliate",
      entityId:   affiliate.id,
      metadata:   { affiliateEmail: affiliate.user.email },
    },
  }).catch(() => {});

  syncGhlTag(affiliate.user.email, "affiliate-applied");

  return successResponse({ status: "SUBMITTED" });
}
