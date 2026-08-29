// Feature 23 — Shareable Referral Hub
// Referral code and link sourced from real affiliate profile data
// QR code generated server-side using the qrcode package (real computed matrix)
// Commission rates computed server-side from COMMISSION_RATES constant and passed as props

import "server-only";
import { requireAffiliateWithOnboarding } from "@/lib/auth/affiliate-session";
import QRCode from "qrcode";
import ReferralHubClient from "@/components/affiliate/ReferralHubClient";
import { COMMISSION_RATES, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function ReferralHubPage() {
  // P1-2 — gate runs in the PAGE, not only the layout: App Router does not
  // re-render the layout on soft navigation, so a sidebar click would bypass
  // a layout-only gate.
  const { affiliate } = await requireAffiliateWithOnboarding();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
  const referralLink = `${appUrl}/auth/signup?ref=${affiliate.referralCode}`;

  // Generate a real QR code encoding the referral link (Reed-Solomon computed matrix)
  const qrDataUrl = await QRCode.toDataURL(referralLink, { width: 200, margin: 2 });

  // Commission amounts per deal — sourced from constants, never hardcoded in the client
  const l1PerDealCents = Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_1);
  const l2PerDealCents = Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_2);
  const l3PerDealCents = Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_3);

  return (
    <ReferralHubClient
      referralCode={affiliate.referralCode}
      referralLink={referralLink}
      qrDataUrl={qrDataUrl}
      l1PerDealCents={l1PerDealCents}
      l2PerDealCents={l2PerDealCents}
      l3PerDealCents={l3PerDealCents}
    />
  );
}
