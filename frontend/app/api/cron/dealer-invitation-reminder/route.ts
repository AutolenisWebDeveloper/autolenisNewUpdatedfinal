// Reminds dealers ~6 hours before an auction deadline if they have not
// submitted an offer yet. Runs hourly; idempotent because
// sendDealerAuctionReminderEmail uses an idempotency key of
// `dealer-auction-reminder-{auctionId}-{email}` (see resend.service.ts),
// so a dealer is reminded at most once per auction.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { sendDealerAuctionReminderEmail } from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Reminder window: 5h-7h before deadline. Cron runs hourly, so this 2h
// window guarantees each invitation gets exactly one bucket while
// tolerating cron-skew or a missed run.
const REMINDER_WINDOW_START_HOURS = 5;
const REMINDER_WINDOW_END_HOURS = 7;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() + REMINDER_WINDOW_START_HOURS * 3600_000);
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_END_HOURS * 3600_000);

  // Active auctions whose deadline lands inside the reminder window.
  const auctions = await prisma.auction.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gte: windowStart, lte: windowEnd },
    },
    select: {
      id: true,
      endsAt: true,
      vehicles: {
        select: { year: true, make: true, model: true },
        take: 1,
      },
      invitations: {
        select: {
          id: true,
          dealerId: true,
          respondedAt: true,
          dealer: {
            select: {
              dealershipName: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });

  let remindersAttempted = 0;
  let remindersSent = 0;
  let remindersSkipped = 0;
  const errors: string[] = [];

  for (const auction of auctions) {
    if (!auction.endsAt) continue;
    const hoursRemaining = Math.max(
      1,
      Math.round((auction.endsAt.getTime() - now.getTime()) / 3600_000),
    );
    const vehicle = auction.vehicles[0];
    const vehicleYear = vehicle?.year ?? now.getFullYear();
    const vehicleMake = vehicle?.make ?? "Vehicle";
    const vehicleModel = vehicle?.model ?? "Requested";

    // Find dealers on this auction who have NOT submitted a SUBMITTED offer.
    const dealerIds = auction.invitations.map((i) => i.dealerId);
    const submittedOffers = await prisma.offer.findMany({
      where: {
        auctionId: auction.id,
        dealerId: { in: dealerIds },
        status: "SUBMITTED",
      },
      select: { dealerId: true },
    });
    const submittedDealerIds = new Set(submittedOffers.map((o) => o.dealerId));

    for (const inv of auction.invitations) {
      if (submittedDealerIds.has(inv.dealerId)) {
        remindersSkipped++;
        continue;
      }
      const email = inv.dealer?.user?.email;
      if (!email) {
        remindersSkipped++;
        continue;
      }
      remindersAttempted++;
      try {
        await sendDealerAuctionReminderEmail({
          to: email,
          contactName: inv.dealer?.dealershipName ?? "Dealer",
          vehicleMake,
          vehicleModel,
          vehicleYear,
          auctionUrl: `${APP_URL}/dealer/auctions/${auction.id}`,
          hoursRemaining,
          auctionId: auction.id,
        });
        remindersSent++;
      } catch (err) {
        errors.push(`auction=${auction.id} dealer=${inv.dealerId}: ${String(err)}`);
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      now: now.toISOString(),
      auctionsInWindow: auctions.length,
      remindersAttempted,
      remindersSent,
      remindersSkipped,
      errors,
    },
  });
}
