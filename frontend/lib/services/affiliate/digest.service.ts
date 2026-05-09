// Weekly affiliate digest service.
//
// Called by the Monday cron route /api/cron/affiliate-digest.
// For each ACTIVE affiliate with weeklyDigestEnabled=true:
//   1. Compute commission activity (L1/L2/L3) since lastDigestSentAt
//   2. Compute new tree joins since lastDigestSentAt (L1+L2+L3 depth)
//   3. Compute total-earned and pending-payout balances
//   4. Send Resend digest email — idempotency key: affiliate-digest-{id}-{ISO year-week}
//   5. On success: update lastDigestSentAt = now()
//
// Idempotency is belt-and-suspenders:
//   - EmailSendLog unique constraint on idempotency_key (enforced in sendIdempotent)
//   - lastDigestSentAt watermark — a second run in the same week skips the affiliate
//
// Safe to re-run: a partial failure (e.g. Resend outage) keeps lastDigestSentAt NOT set,
// so the next cron tick retries. Successfully-sent digests are EmailSendLog-deduped.

import { prisma } from "@/lib/prisma";
import { sendAffiliateWeeklyDigest } from "@/lib/services/email/resend.service";
import crypto from "crypto";
import { AffiliateStatus } from "@prisma/client";

export interface DigestSendResult {
  affiliateId: string;
  email: string;
  status: "sent" | "skipped_no_activity" | "skipped_opted_out" | "skipped_same_week" | "failed";
  reason?: string;
}

// Returns ISO-8601 year-week key (e.g. "2026-W17") — stable identifier for idempotency
function isoYearWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

async function backfillUnsubscribeToken(affiliateId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("hex");
  await prisma.affiliate.update({
    where: { id: affiliateId },
    data: { unsubscribeToken: token },
  });
  return token;
}

export async function sendWeeklyDigestForAffiliate(affiliateId: string, now: Date = new Date()): Promise<DigestSendResult> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    include: { user: { select: { email: true } } },
  });
  if (!affiliate) return { affiliateId, email: "", status: "failed", reason: "Affiliate not found" };
  if (affiliate.status !== AffiliateStatus.ACTIVE) {
    return { affiliateId, email: affiliate.user.email, status: "skipped_opted_out", reason: "Not ACTIVE" };
  }
  if (!affiliate.weeklyDigestEnabled) {
    return { affiliateId, email: affiliate.user.email, status: "skipped_opted_out" };
  }

  // Guard against double-send within the same ISO week
  if (affiliate.lastDigestSentAt) {
    if (isoYearWeek(affiliate.lastDigestSentAt) === isoYearWeek(now)) {
      return { affiliateId, email: affiliate.user.email, status: "skipped_same_week" };
    }
  }

  // Activity watermark — use lastDigestSentAt, or 7 days ago if first digest
  const since = affiliate.lastDigestSentAt ?? new Date(now.getTime() - 7 * 24 * 3600000);

  // 1. Commission activity since watermark, bucketed by level
  const commissions = await prisma.commission.findMany({
    where: { affiliateId, createdAt: { gte: since } },
    select: { level: true, amountCents: true },
  });

  const bucket = { l1: { count: 0, cents: 0 }, l2: { count: 0, cents: 0 }, l3: { count: 0, cents: 0 } };
  for (const c of commissions) {
    const key = c.level === 1 ? "l1" : c.level === 2 ? "l2" : c.level === 3 ? "l3" : null;
    if (!key) continue;
    bucket[key].count += 1;
    bucket[key].cents += c.amountCents;
  }

  // 2. Tree delta — new affiliates joined this affiliate's sub-tree since watermark
  const l1Ids = (await prisma.affiliate.findMany({ where: { parentId: affiliate.id }, select: { id: true } })).map((a) => a.id);
  const l2Ids = l1Ids.length
    ? (await prisma.affiliate.findMany({ where: { parentId: { in: l1Ids } }, select: { id: true } })).map((a) => a.id)
    : [];
  const allDescendantIds = [affiliate.id, ...l1Ids, ...l2Ids];

  const newJoins = await prisma.affiliate.count({
    where: { parentId: { in: allDescendantIds }, createdAt: { gte: since } },
  });

  // 3. Lifetime totals
  const allCommissions = await prisma.commission.findMany({
    where: { affiliateId },
    select: { amountCents: true, status: true },
  });
  const totalCentsLifetime = allCommissions.reduce((s, c) => s + c.amountCents, 0);
  const pendingCentsLifetime = allCommissions.filter((c) => c.status === "PENDING" || c.status === "APPROVED").reduce((s, c) => s + c.amountCents, 0);

  // 4. Skip if truly no activity (avoids empty-digest noise)
  const hasCommissionActivity = bucket.l1.count + bucket.l2.count + bucket.l3.count > 0;
  const hasTreeGrowth = newJoins > 0;
  if (!hasCommissionActivity && !hasTreeGrowth) {
    return { affiliateId, email: affiliate.user.email, status: "skipped_no_activity" };
  }

  // 5. Ensure we have an unsubscribe token
  let unsubscribeToken = affiliate.unsubscribeToken;
  if (!unsubscribeToken) unsubscribeToken = await backfillUnsubscribeToken(affiliate.id);

  // 6. Send the email (sendIdempotent via EmailSendLog)
  const firstName = affiliate.user.email.split("@")[0];
  const week = isoYearWeek(now);
  try {
    await sendAffiliateWeeklyDigest({
      to: affiliate.user.email,
      firstName,
      referralCode: affiliate.referralCode,
      weekKey: week,
      activity: bucket,
      newJoins,
      totalEarnedCents: totalCentsLifetime,
      pendingPayoutCents: pendingCentsLifetime,
      unsubscribeToken,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[affiliate-digest] send failed", { affiliateId, err: err instanceof Error ? err.message : err });
    return { affiliateId, email: affiliate.user.email, status: "failed", reason: "Resend send failed" };
  }

  // 7. Watermark
  await prisma.affiliate.update({
    where: { id: affiliate.id },
    data: { lastDigestSentAt: now },
  });

  return { affiliateId, email: affiliate.user.email, status: "sent" };
}

export async function runWeeklyDigestBatch(now: Date = new Date()): Promise<{ total: number; sent: number; skipped: number; failed: number; results: DigestSendResult[] }> {
  // Only ACTIVE affiliates with digest enabled, bounded to 500/run for cron timeout safety
  const affiliates = await prisma.affiliate.findMany({
    where: { status: AffiliateStatus.ACTIVE, weeklyDigestEnabled: true },
    select: { id: true },
    take: 500,
  });

  const results: DigestSendResult[] = [];
  for (const { id } of affiliates) {
    // Sequential to avoid Resend API rate-limit cliffs; 500 * ~250ms = ~2 min max
    const r = await sendWeeklyDigestForAffiliate(id, now);
    results.push(r);
  }
  return {
    total: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status.startsWith("skipped")).length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
