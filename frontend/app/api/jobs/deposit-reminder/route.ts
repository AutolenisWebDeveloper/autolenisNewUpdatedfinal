import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import { hasPaidDeposit } from "@/lib/qstash/state";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
  touchNumber: number;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, touchNumber } = (await request.json()) as Payload;

    if (await hasPaidDeposit(buyerId)) {
      return NextResponse.json({ success: true, stopped: "paid" });
    }

    const dashboardUrl = `${NOTIFY_APP_URL}/buyer/dashboard`;

    if (touchNumber === 1) {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `Hey ${firstName} — your AutoLenis auction slot is reserved. Activate it for ${DEPOSIT_AMOUNT_USD}: autolenis.com/buyer/dashboard`,
        emailSubject: "Your dealer auction is ready to launch",
        emailHtml: renderEmail({
          heading: "Your dealer auction is ready to launch",
          bodyHtml: `<p>Hi ${firstName},</p><p>Your auction slot is reserved. Activate it for ${DEPOSIT_AMOUNT_USD} and local dealers will start competing for your vehicle.</p>`,
          ctaText: `Activate for ${DEPOSIT_AMOUNT_USD}`,
          ctaUrl: dashboardUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/deposit-reminder",
        body: { buyerId, firstName, email, touchNumber: 2 },
        delaySeconds: 86400,
      });
    } else if (touchNumber === 2) {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `${firstName}, your AutoLenis auction slot is still on hold. Activate for ${DEPOSIT_AMOUNT_USD} before it's released: autolenis.com/buyer/dashboard`,
        emailSubject: "Your reserved auction slot is still waiting",
        emailHtml: renderEmail({
          heading: "Your reserved auction slot is still waiting",
          bodyHtml: `<p>Hi ${firstName},</p><p>We're still holding your auction slot. Activate for ${DEPOSIT_AMOUNT_USD} to put dealers to work before the hold expires.</p>`,
          ctaText: `Activate for ${DEPOSIT_AMOUNT_USD}`,
          ctaUrl: dashboardUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/deposit-reminder",
        body: { buyerId, firstName, email, touchNumber: 3 },
        delaySeconds: 172800,
      });
    } else {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `${firstName}, your AutoLenis auction slot expires soon. Activate for ${DEPOSIT_AMOUNT_USD} now: autolenis.com/buyer/dashboard`,
        emailSubject: "Your auction slot expires soon",
        emailHtml: renderEmail({
          heading: "Your auction slot expires soon",
          bodyHtml: `<p>Hi ${firstName},</p><p>This is your final reminder — your reserved auction slot is about to be released. Activate for ${DEPOSIT_AMOUNT_USD} to keep it.</p>`,
          ctaText: `Activate for ${DEPOSIT_AMOUNT_USD}`,
          ctaUrl: dashboardUrl,
        }),
      });
      // Sequence complete.
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
