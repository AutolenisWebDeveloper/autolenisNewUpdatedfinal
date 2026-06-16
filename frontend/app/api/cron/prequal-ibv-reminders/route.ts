import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });
  const pending = await prisma.preQualification.findMany({
    where: { decision: "PENDING", createdAt: { lt: new Date(Date.now() - 24 * 3600000) } },
    include: { buyer: true }, take: 50,
  });
  for (const pq of pending) {
    await prisma.notification.create({ data: { buyerId: pq.buyerId, title: "Complete your prequalification", body: "Your identity verification is pending.", type: "SYSTEM_ALERT" } }).catch(() => {});
  }

  // Warn buyers whose APPROVED prequal expires within 7 days
  const expiringPrequals = await prisma.preQualification.findMany({
    where: {
      decision: "APPROVED",
      expiresAt: {
        gte: new Date(),
        lte: new Date(Date.now() + 7 * 24 * 3600000),
      },
    },
    include: {
      buyer: {
        include: { user: { select: { email: true } } },
      },
    },
    take: 100,
  });

  for (const pq of expiringPrequals) {
    const daysLeft = Math.ceil((pq.expiresAt.getTime() - Date.now()) / (24 * 3600000));

    // In-app notification
    await prisma.notification.create({
      data: {
        buyerId: pq.buyerId,
        title: `Your prequalification expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
        body: "Complete your vehicle search and pay the deposit before your approval expires.",
        type: "SYSTEM_ALERT",
        actionUrl: "/buyer/prequal",
      },
    }).catch(() => {});

    // Email (non-blocking)
    if (pq.buyer?.user?.email && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: "AutoLenis <noreply@autolenis.com>",
          to: pq.buyer.user.email,
          subject: `Your AutoLenis prequalification expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
          text: `Your prequalification approval expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}.\n\nLog in to complete your vehicle search and pay the $99 Auction Access Deposit before it expires.\n\n${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/deposit`,
        });
      } catch (err) {
        logger.error(`[prequal-ibv-reminders] expiry email failed:`, err);
      }
    }
  }

  return NextResponse.json({ success: true, data: { reminded: pending.length, expiryWarnings: expiringPrequals.length } });
}
