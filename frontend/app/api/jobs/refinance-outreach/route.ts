import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { notifyContact, renderEmail } from "@/lib/qstash/notify";
import { buildPartnerRedirectUrl } from "@/lib/services/refinance/refinance-lead.service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
  leadId: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, leadId } = (await request.json()) as Payload;

    // Compliance: refinance outreach is for buyers who completed a purchase only.
    // The 60-day sequence is seeded after deal-complete, but guard here too so an
    // out-of-sequence dispatch can never reach an earlier-stage buyer.
    const completedDeals = await prisma.deal.count({
      where: { buyerId, status: "COMPLETED" },
    });
    if (completedDeals === 0) {
      return NextResponse.json({ success: true, skipped: "no_completed_purchase" });
    }

    // Send once. Stop if the buyer has already been emailed or has already
    // engaged the refinance link.
    const priorEvent = await prisma.buyerActivityEvent.findFirst({
      where: {
        buyerId,
        eventType: { in: ["REFINANCE_LINK_CLICKED", "REFINANCE_EMAIL_SENT"] },
      },
      select: { id: true },
    });
    if (priorEvent) {
      return NextResponse.json({ success: true, skipped: "already_sent_or_clicked" });
    }

    // OpenRoad Lending partner URL: aid=1445 always present, opt_1 = the real
    // leadId (hard-fails on empty). AutoLenis is a lead provider only.
    const partnerUrl = buildPartnerRedirectUrl(leadId);

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      email,
      // The "Reply STOP to opt out." suffix is appended by the notify layer.
      sms: `Hi ${firstName} — did you know you could lower your monthly payment on your recent vehicle purchase? AutoLenis has connected with OpenRoad Lending to help buyers explore refinancing options. Check your options here: autolenis.com/buyer/refinance`,
      emailSubject: "Could you lower your car payment?",
      emailHtml: renderEmail({
        heading: "Could you lower your car payment?",
        bodyHtml:
          `<p>Hi ${firstName} — congratulations again on your recent vehicle purchase through AutoLenis.</p>` +
          `<p>Many buyers find they can reduce their monthly payment through refinancing — especially if your credit has improved or rates have changed since your purchase.</p>` +
          `<p>AutoLenis connects you with OpenRoad Lending to explore your refinancing options.</p>` +
          `<p><strong>Important:</strong> AutoLenis is not a lender or broker. We connect you with OpenRoad Lending as a lead provider only.</p>` +
          `<p>This link is personalized for you. If you have any questions contact <a href="mailto:support@autolenis.com">support@autolenis.com</a></p>` +
          `<p>AutoLenis Team</p>`,
        ctaText: "Explore your options",
        ctaUrl: partnerUrl,
      }),
    });

    // Log so we never send twice.
    await prisma.buyerActivityEvent.create({
      data: {
        buyerId,
        eventType: "REFINANCE_EMAIL_SENT",
        title: "Refinance outreach sent (OpenRoad Lending)",
        metadata: { leadId, partnerUrl },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    // Return 500 so QStash retries.
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
