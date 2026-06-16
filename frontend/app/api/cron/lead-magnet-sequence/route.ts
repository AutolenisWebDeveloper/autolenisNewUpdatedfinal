// Phase C-Leads — daily dispatcher for the lead-magnet nurture sequence.
//
// Day 0 (delivery) is handled at capture time. This cron fires the day 1+
// follow-up touches: for every lead-magnet BuyerOpportunity within the lookback
// window, it computes the lead's age in days, finds the step due exactly today
// for that lead's track, resolves the CRM contact id, and queues the send.
// Per-step idempotency (per contact, per UTC day) lives in the sequence module,
// so a double cron run is safe.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getServiceSupabase } from "@/lib/supabase-service";
import {
  dueStep,
  LEAD_MAGNET_MAX_DAY,
} from "@/lib/services/email/lead-magnet-sequence";
import {
  getLeadMagnet,
  isValidTimeline,
  trackForTimeline,
} from "@/lib/leads/lead-magnets";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  // Lookback covers the longest schedule plus a one-day safety margin.
  const since = new Date(now - (LEAD_MAGNET_MAX_DAY + 1) * DAY_MS);

  const leads = await prisma.buyerOpportunity.findMany({
    where: {
      source: { startsWith: "lead_magnet:" },
      createdAt: { gte: since },
      email: { not: null },
    },
    select: {
      email: true,
      firstName: true,
      timeline: true,
      source: true,
      createdAt: true,
    },
  });

  const supabase = getServiceSupabase();
  let queued = 0;
  let suppressed = 0;
  let skipped = 0;

  for (const lead of leads) {
    const email = lead.email?.toLowerCase();
    if (!email || !isValidTimeline(lead.timeline)) {
      skipped++;
      continue;
    }

    const ageDays = Math.floor((now - lead.createdAt.getTime()) / DAY_MS);
    const track = trackForTimeline(lead.timeline);
    const step = dueStep(track, ageDays);
    if (!step) {
      skipped++;
      continue;
    }

    // Resolve the CRM contact id the Inngest worker needs for suppression +
    // timeline logging. No contact → the lead was never persisted to CRM; skip.
    let contactId: string | null = null;
    try {
      const { data } = await supabase
        .from("contacts")
        .select("id")
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle();
      contactId = (data?.id as string | undefined) ?? null;
    } catch (err) {
      logger.error("[lead-magnet-sequence] contact lookup failed:", err);
    }
    if (!contactId) {
      skipped++;
      continue;
    }

    const magnetSlug = lead.source?.split(":")[1];
    const magnet = getLeadMagnet(magnetSlug);

    try {
      const res = await step.send({
        to: email,
        firstName: lead.firstName || "there",
        contactId,
        magnetTitle: magnet.title,
      });
      if (res.status === "queued") queued++;
      else suppressed++;
    } catch (err) {
      logger.error("[lead-magnet-sequence] step send failed:", err);
      skipped++;
    }
  }

  return NextResponse.json({
    success: true,
    scanned: leads.length,
    queued,
    suppressed,
    skipped,
  });
}
