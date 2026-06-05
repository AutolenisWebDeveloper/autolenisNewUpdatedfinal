// lib/services/affiliate/referral.service.ts
// Group 8 (8A) — referral link generation, click tracking, and click→conversion
// attribution. Referral CODES already live on Affiliate.referralCode (issued at
// registration). This service owns the funnel layer on top of that code: the
// shareable link, the affiliate_clicks ledger, and linking a click to the buyer
// signup it produced.
//
// All functions are defensive and non-throwing where they sit on a hot path
// (a CRM/analytics hiccup must never break a public page load or a signup).

import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const DEFAULT_APP_URL = "https://autolenis.com";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, "");
}

// Salted SHA-256 of the visitor IP — we never store raw IPs. The salt prefix
// keeps hashes from being trivially reversible via a rainbow table of IPs.
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.REFERRAL_IP_SALT ?? "autolenis-referral";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// Canonical shareable link for an affiliate's referral code. Lands on the buyer
// signup, where the code is pre-filled and persisted (see lib/auth/actions.ts).
export function getReferralLink(referralCode: string): string {
  return `${appUrl()}/auth/signup?ref=${encodeURIComponent(referralCode)}`;
}

export interface TrackClickInput {
  referralCode: string;
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  landingPath?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export interface TrackClickResult {
  tracked: boolean;
  reason?: "unknown_code" | "error";
}

// Records one affiliate_clicks row for an inbound ?ref= visit. Resolves the code
// to an affiliate first — unknown codes are a silent no-op so the endpoint stays
// safe to expose publicly. Never throws.
export async function trackClick(input: TrackClickInput): Promise<TrackClickResult> {
  const code = input.referralCode?.trim();
  if (!code) return { tracked: false, reason: "unknown_code" };

  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!affiliate) {
      console.warn(`[group-8] trackClick: no affiliate for code ${code}`);
      return { tracked: false, reason: "unknown_code" };
    }

    await prisma.affiliateClick.create({
      data: {
        affiliateId: affiliate.id,
        referralCode: code,
        ipHash: hashIp(input.ip),
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        referer: input.referer?.slice(0, 1024) ?? null,
        landingPath: input.landingPath?.slice(0, 1024) ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
      },
    });

    return { tracked: true };
  } catch (err) {
    console.error("[group-8] trackClick failed:", err);
    return { tracked: false, reason: "error" };
  }
}

// Links a referral click to the buyer signup it produced. Called from the signup
// attribution path (lib/auth/actions.ts) when a referred user is created. We mark
// the most recent unconverted click for that code as converted, which closes the
// click→conversion loop for the affiliate's dashboard. Non-blocking by contract.
export async function attributeConversion(
  referralCode: string,
  referredUserId: string,
): Promise<void> {
  const code = referralCode?.trim();
  if (!code || !referredUserId) return;

  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!affiliate) return;

    const latestUnconverted = await prisma.affiliateClick.findFirst({
      where: { affiliateId: affiliate.id, convertedAt: null },
      orderBy: { clickedAt: "desc" },
      select: { id: true },
    });

    if (latestUnconverted) {
      await prisma.affiliateClick.update({
        where: { id: latestUnconverted.id },
        data: { convertedAt: new Date(), referredUserId },
      });
    }
  } catch (err) {
    console.error("[group-8] attributeConversion failed:", err);
    // Non-blocking — signup must never fail because of click attribution.
  }
}

export interface ReferralClickStats {
  totalClicks: number;
  clicksThisMonth: number;
  convertedClicks: number;
  // clicks → conversions, as a 0–100 percentage (1 decimal). 0 when no clicks.
  conversionRate: number;
}

// Click-funnel stats for a single affiliate, used on the affiliate dashboard and
// referral hub. Returns a safe zero-state on error.
export async function getReferralClickStats(affiliateId: string): Promise<ReferralClickStats> {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalClicks, clicksThisMonth, convertedClicks] = await Promise.all([
      prisma.affiliateClick.count({ where: { affiliateId } }),
      prisma.affiliateClick.count({ where: { affiliateId, clickedAt: { gte: startOfMonth } } }),
      prisma.affiliateClick.count({ where: { affiliateId, convertedAt: { not: null } } }),
    ]);

    const conversionRate =
      totalClicks > 0 ? Math.round((convertedClicks / totalClicks) * 1000) / 10 : 0;

    return { totalClicks, clicksThisMonth, convertedClicks, conversionRate };
  } catch (err) {
    console.error("[group-8] getReferralClickStats failed:", err);
    return { totalClicks: 0, clicksThisMonth: 0, convertedClicks: 0, conversionRate: 0 };
  }
}
