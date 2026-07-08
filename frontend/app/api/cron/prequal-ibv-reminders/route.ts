import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// Daily reminders. Both branches are idempotent: an existing notification of
// the same purpose for the buyer gates re-sends, so a buyer whose approval
// expires in 7 days is reminded ONCE, not on all 7 daily runs (and the expiry
// email — gated behind the same check — can't duplicate either).
export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });

  // ── Pending-verification nudge (once per pending prequal) ──────────────────
  const pending = await prisma.preQualification.findMany({
    where: { decision: "PENDING", createdAt: { lt: new Date(Date.now() - 24 * 3600000) } },
    take: 50,
  });
  let pendingReminded = 0;
  for (const pq of pending) {
    // Idempotent: skip if we've already nudged this buyer since the prequal was
    // created (avoids a fresh notification every daily run).
    const already = await prisma.notification.findFirst({
      where: {
        buyerId: pq.buyerId,
        type: "SYSTEM_ALERT",
        title: "Complete your prequalification",
        createdAt: { gte: pq.createdAt },
      },
      select: { id: true },
    });
    if (already) continue;
    await prisma.notification
      .create({
        data: {
          buyerId: pq.buyerId,
          title: "Complete your prequalification",
          body: "Your identity verification is pending.",
          type: "SYSTEM_ALERT",
        },
      })
      .then(() => { pendingReminded++; })
      .catch((err) => logger.error("[prequal-ibv-reminders] pending notification failed:", err));
  }

  // ── Expiry warning (once per approval's 7-day expiry window) ───────────────
  const expiringPrequals = await prisma.preQualification.findMany({
    where: {
      decision: "APPROVED",
      expiresAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600000) },
    },
    include: { buyer: { include: { user: { select: { email: true } } } } },
    take: 100,
  });

  let expiryWarned = 0;
  for (const pq of expiringPrequals) {
    // Idempotent gate for BOTH the notification and the email: if we've already
    // warned this buyer within the current 7-day window, skip entirely.
    const windowStart = new Date(pq.expiresAt.getTime() - 7 * 24 * 3600000);
    const alreadyWarned = await prisma.notification.findFirst({
      where: {
        buyerId: pq.buyerId,
        type: "SYSTEM_ALERT",
        title: { startsWith: "Your prequalification expires in" },
        createdAt: { gte: windowStart },
      },
      select: { id: true },
    });
    if (alreadyWarned) continue;

    const daysLeft = Math.ceil((pq.expiresAt.getTime() - Date.now()) / (24 * 3600000));

    await prisma.notification
      .create({
        data: {
          buyerId: pq.buyerId,
          title: `Your prequalification expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
          body: "Complete your vehicle search and pay the deposit before your approval expires.",
          type: "SYSTEM_ALERT",
          actionUrl: "/buyer/prequal",
        },
      })
      .catch((err) => logger.error("[prequal-ibv-reminders] expiry notification failed:", err));
    expiryWarned++;

    // Email (non-blocking) — gated by the notification check above, so it fires
    // at most once per window.
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

  return NextResponse.json({ success: true, data: { reminded: pendingReminded, expiryWarnings: expiryWarned } });
}
