import type { Metadata } from "next";
import LandingPageClient from "./LandingPageClient";

// Campaign-channel headline map. Each channel gets a sharp 3–6 word authority
// headline (Part 11). New campaigns fall back to `default`.
const CAMPAIGN_HEADLINES: Record<string, { h1: string; sub: string }> = {
  facebook: {
    h1: "Stop Negotiating Alone.",
    sub: "Verified dealers compete for your business in a private 48-hour auction.",
  },
  google: {
    h1: "Dealers Compete. You Choose.",
    sub: "Submit your vehicle request. Verified dealers send competing offers within 48 hours.",
  },
  tiktok: {
    h1: "The Table Just Turned.",
    sub: "Dealers compete for your business. You compare offers from home — no showroom, no pressure.",
  },
  youtube: {
    h1: "Take Back Control of Car Buying.",
    sub: "AutoLenis activates a private 48-hour dealer auction. Multiple offers. One decision — yours.",
  },
  default: {
    h1: "Where Dealers Compete for You.",
    sub: "A private 48-hour dealer auction. Verified offers. You choose on your terms.",
  },
};

export const metadata: Metadata = {
  title: "Where Dealers Compete for You — AutoLenis",
  description:
    "Submit a vehicle request. Verified dealers compete in a private 48-hour auction. Compare every offer side-by-side. Choose on your terms.",
  robots: { index: false, follow: false },
};

export default async function LandingPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  const { campaign } = await params;
  const slug = (campaign ?? "default").toLowerCase();
  const headlines = CAMPAIGN_HEADLINES[slug] ?? CAMPAIGN_HEADLINES.default;
  return (
    <LandingPageClient
      campaign={slug}
      headline={headlines.h1}
      subheadline={headlines.sub}
    />
  );
}
