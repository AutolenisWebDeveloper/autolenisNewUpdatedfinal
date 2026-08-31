// Production deps for sendDealerSms.
//
// WHY THIS MODULE EXISTS. The send service deliberately ships with no default
// loadTarget, dispatch, suppression or quiet-hours implementation: every one of
// those defaults would be a way for a test to reach a real vendor by forgetting
// to override it. The cost of that safety is that SOMETHING has to supply them
// in production, and if that something lives inside a route handler it is
// untestable and gets copy-pasted the second a second caller appears (a cron, a
// batch action). It lives here instead — one place, unit-testable, and thin
// enough that a reviewer can see the whole wiring at once.
//
// FAILING CLOSED IS THE POINT. A suppression lookup that throws must block the
// send, not wave it through; the service already defaults both predicates to
// "blocked", and these implementations preserve that on error rather than
// letting an outage become permission to message someone who said STOP.

import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { isRecipientInQuietHours } from "@/lib/crm/recipient-timezone";
import { SuppressionService } from "@/lib/services/suppression.service";
import { getServiceSupabase } from "@/lib/supabase-service";
import type { DealerSmsDeps, DealerSmsTarget } from "./dealer-sms-send.service";

/**
 * Resolve the consent facts for a prospect.
 *
 * Consent, DNC status and phone type live on the CONTACT PROFILE, not on the
 * prospect: they are properties of the person and the number, and a rooftop can
 * have several. The prospect supplies the number actually dialled and the
 * location quiet hours are computed against.
 *
 * A prospect with no contact profile is NOT an error — it resolves to consent
 * basis NONE, which the gate refuses. That is the correct answer for a
 * vendor-sourced number nobody has a consent record for.
 */
export async function loadDealerSmsTarget(
  prospectId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<DealerSmsTarget | null> {
  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: { id: true, phone: true, state: true, zip: true, rooftopId: true },
  });
  if (!prospect) return null;

  const profile = prospect.rooftopId
    ? await prisma.dealerContactProfile.findFirst({
        where: { rooftopId: prospect.rooftopId },
        orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }],
        select: { consentBasis: true, dncStatus: true, phoneType: true },
      })
    : null;

  return {
    prospectId: prospect.id,
    phone: prospect.phone,
    state: prospect.state,
    zip: prospect.zip,
    consentBasis: profile?.consentBasis ?? null,
    dncStatus: profile?.dncStatus ?? null,
    phoneType: profile?.phoneType ?? null,
  };
}

/**
 * A live attempt at this step, if one exists. "Live" is anything that is not
 * `failed` — a queued row is an in-flight send, and a second one would be a
 * duplicate message, not a retry.
 */
export async function findPriorLiveSmsAttempt(
  prospectId: string,
  step: number,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ id: string } | null> {
  return prisma.dealerOutreachLog.findFirst({
    where: {
      dealerProspectId: prospectId,
      channel: "sms",
      outreachSequenceStep: step,
      status: { not: "failed" },
    },
    select: { id: true },
  });
}

/** Canonical STOP store. Fails CLOSED: an unreadable list is a blocked send. */
export async function isDealerPhoneSuppressed(phone: string): Promise<boolean> {
  try {
    return await SuppressionService.isSmsSuppressed(getServiceSupabase(), phone);
  } catch (err) {
    logger.error("[dealer-sms] suppression lookup failed — failing closed:", err);
    return true;
  }
}

/** Twilio, constructed lazily. Absent config yields no dispatcher at all, which
 *  the service reports as `not_configured` rather than pretending to send. */
function twilioDispatch(): DealerSmsDeps["dispatch"] | undefined {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_DEALER_OUTREACH_NUMBER ?? process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return undefined;

  return async (to: string, body: string) => {
    try {
      // Required by twilio's own typings; imported here so a session that never
      // sends never loads the SDK.
      const twilio = (await import("twilio")).default;
      const message = await twilio(sid, token).messages.create({
        from,
        to,
        // The opt-out disclosure is appended at the boundary, exactly as the CRM
        // path does it, so no caller can compose a message without one.
        body: `${body}\n\nReply STOP to opt out.`,
      });
      return { sid: message.sid ?? null, error: message.sid ? null : "Twilio returned no sid" };
    } catch (err) {
      return { sid: null, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/** Everything sendDealerSms needs in production, in one object. */
export function dealerSmsProductionDeps(prisma: PrismaClient = defaultPrisma): Partial<DealerSmsDeps> {
  return {
    prisma,
    loadTarget: (id) => loadDealerSmsTarget(id, prisma),
    findPriorLiveAttempt: (id, step) => findPriorLiveSmsAttempt(id, step, prisma),
    isSmsSuppressed: isDealerPhoneSuppressed,
    inQuietHours: (now, loc) => isRecipientInQuietHours(now, loc),
    dispatch: twilioDispatch(),
  };
}
