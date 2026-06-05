// GET /api/admin/dealer-outreach/email-health — Phase 4B-2.
// Reports whether the dealer outreach sending domain is configured and ready,
// so the founder can see (in admin) if email infra is wired up before sending.
// Read-only: inspects env config only, never sends anything.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { missingEmailEnvVars } from "@/lib/services/dealer-recruitment/dealer-email-send.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const missingVars = missingEmailEnvVars();
  const configured = missingVars.length === 0;

  return adminSuccess({
    configured,
    missingVars,
    fromEmail: process.env.DEALER_OUTREACH_FROM_EMAIL ?? null,
    replyTo: process.env.DEALER_OUTREACH_REPLY_TO ?? null,
    hasPhysicalAddress: Boolean(process.env.AUTOLENIS_PHYSICAL_ADDRESS?.trim()),
    warmingRecommendation: {
      week1MaxDaily: 20,
      week2MaxDaily: 50,
      week3MaxDaily: 100,
      warning:
        "Send slowly — domain is cold until verified in Resend dashboard",
    },
    resendDashboardUrl: "https://resend.com/domains",
  });
}
