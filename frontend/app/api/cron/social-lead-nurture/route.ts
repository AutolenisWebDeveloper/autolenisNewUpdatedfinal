// Social lead nurture — daily dispatcher for the 5-step social email sequence.
//
// For every active SocialLead within the lookback window, advances the buyer to
// the next nurture step when enough time has elapsed since capture, sends the
// matching nurture email, and records progress. Day-gating prevents sending too
// early; once step 5 is delivered the lead is marked DEAD. Runs at 15:00 UTC
// (10:00 CT). Per-step idempotency lives in sendSocialLeadNurtureEmail, so a
// double cron run never double-sends.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSocialLeadNurtureEmail } from "@/lib/services/email/resend.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  // Cutover gate: this cron dispatches nurture email via Resend OUTSIDE the
  // Make-owned /api/crm/dispatch/* path. With Make as the sole nurture sender it
  // must no-op, or it double-sends. Governed by the same master kill-switch as
  // the in-app engine; the schedule is also removed from vercel.json so Vercel
  // never invokes it. Re-enable only if reverting to legacy in-app nurture.
  if (process.env.CRM_INAPP_ENGINE_ENABLED !== "true") {
    return NextResponse.json({ success: true, skipped: "inapp_engine_disabled" });
  }

  // Find leads that need the next nurture email.
  const leadsToNurture = await prisma.socialLead.findMany({
    where: {
      status: { in: ["NEW", "NURTURING"] },
      convertedAt: null,
      createdAt: { gte: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      OR: [
        { lastEmailSentAt: null },
        { lastEmailSentAt: { lte: new Date(Date.now() - 20 * 60 * 60 * 1000) } },
      ],
    },
    take: 100,
  });

  let emailsSent = 0;
  let sequencesCompleted = 0;

  for (const lead of leadsToNurture) {
    try {
      const nextStep = lead.nurtureStep + 1;

      // Day gating — don't send too early.
      const daysSinceCreated =
        (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24);

      if (nextStep === 1 && daysSinceCreated < 0.8) continue;
      if (nextStep === 2 && daysSinceCreated < 1.8) continue;
      if (nextStep === 3 && daysSinceCreated < 2.8) continue;
      if (nextStep === 4 && daysSinceCreated < 4.5) continue;
      if (nextStep === 5 && daysSinceCreated < 6.5) continue;

      if (nextStep > 5) {
        // Sequence complete.
        await prisma.socialLead.update({
          where: { id: lead.id },
          data: { status: "DEAD" },
        });
        sequencesCompleted++;
        continue;
      }

      // Send nurture email.
      await sendSocialLeadNurtureEmail({
        to: lead.email,
        firstName: lead.firstName,
        step: nextStep,
        vehicleInterest: lead.vehicleInterest ?? undefined,
        city: lead.city ?? undefined,
      });

      // Update lead record.
      await prisma.socialLead.update({
        where: { id: lead.id },
        data: {
          nurtureStep: nextStep,
          nurtureSequence: "social_5step",
          lastEmailSentAt: new Date(),
          status: "NURTURING",
        },
      });

      emailsSent++;
    } catch (err) {
      logger.error("[social-nurture] failed for lead:", lead.id, err);
    }
  }

  logger.info(`[social-nurture] emails sent: ${emailsSent}`);
  logger.info(`[social-nurture] sequences completed: ${sequencesCompleted}`);

  return NextResponse.json({
    success: true,
    scanned: leadsToNurture.length,
    emailsSent,
    sequencesCompleted,
  });
}
