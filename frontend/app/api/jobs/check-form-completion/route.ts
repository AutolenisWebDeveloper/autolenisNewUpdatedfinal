import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import { hasPaidDeposit } from "@/lib/qstash/state";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  touchNumber: number;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, touchNumber } = (await request.json()) as Payload;

    // Converted already → exit the sequence.
    if (await hasPaidDeposit(buyerId)) {
      return NextResponse.json({ success: true, stopped: "completed" });
    }

    const buyer = await prisma.buyer.findUnique({
      where: { id: buyerId },
      select: { firstName: true },
    });
    const firstName = buyer?.firstName ?? "there";
    const activateUrl = `${NOTIFY_APP_URL}/buyer/dashboard`;

    if (touchNumber === 1) {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        sms: `${firstName}, dealers are waiting for you on AutoLenis. Activate your auction to let them compete: autolenis.com/buyer/dashboard`,
        emailSubject: "Dealers are waiting for you",
        emailHtml: renderEmail({
          heading: "Dealers are waiting for you",
          bodyHtml: `<p>Hi ${firstName},</p><p>Local dealers are ready to compete for your vehicle — but your auction isn't active yet. Finish activating to get them bidding.</p>`,
          ctaText: "Activate my auction",
          ctaUrl: activateUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/check-form-completion",
        body: { buyerId, touchNumber: 2 },
        delaySeconds: 82800,
      });
    } else if (touchNumber === 2) {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        sms: `${firstName}, your AutoLenis auction room is still empty. Activate now and let dealers compete: autolenis.com/buyer/dashboard`,
        emailSubject: "The auction room is still empty",
        emailHtml: renderEmail({
          heading: "The auction room is still empty",
          bodyHtml: `<p>Hi ${firstName},</p><p>No dealers can bid until you activate your auction. It only takes a minute and puts dealers to work for you.</p>`,
          ctaText: "Activate my auction",
          ctaUrl: activateUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/check-form-completion",
        body: { buyerId, touchNumber: 3 },
        delaySeconds: 259200,
      });
    } else {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        sms: `${firstName}, last chance — we'll close your AutoLenis file soon. Activate to keep dealers competing: autolenis.com/buyer/dashboard`,
        emailSubject: "Last chance — we will close your file",
        emailHtml: renderEmail({
          heading: "Last chance — we will close your file",
          bodyHtml: `<p>Hi ${firstName},</p><p>This is the final reminder. If you don't activate soon we'll close out your request. You can pick back up any time by activating your auction.</p>`,
          ctaText: "Activate before we close it",
          ctaUrl: activateUrl,
        }),
      });
      // Abandonment sequence complete — no further touches.
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
