import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration";
import Clarity from "@/components/seo/Clarity";
import TikTokPixel from "@/components/analytics/TikTokPixel";
import CookieBanner from "@/components/public/CookieBanner";
import ReferralCapture from "@/components/referral/ReferralCapture";
import { JsonLd } from "@/lib/seo/jsonld";
import { entityGraphSchema } from "@/lib/seo/entity-graph";
import OrganizationSchema from "@/components/seo/OrganizationSchema";
import "./globals.css";

// Self-hosted Google fonts via @fontsource — bundled at build time, no
// runtime/build-time network calls to fonts.googleapis.com / fonts.gstatic.com.
const spaceGrotesk = localFont({
  variable: "--font-heading",
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});
const jetbrainsMono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

// Additive (For Dealers redesign): display + body faces, self-hosted via
// @fontsource to keep the build network-free. Exposed as CSS variables and
// consumed by the `font-display` / `font-body` Tailwind tokens in globals.css.
const plusJakartaSans = localFont({
  variable: "--font-jakarta",
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
});
const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: {
    default: "AutoLenis — The Car Buying Experience You Deserve",
    template: "%s | AutoLenis",
  },
  description:
    "AutoLenis is a premium automotive fintech concierge platform. Skip the negotiation — let dealers compete for your business.",
  metadataBase: new URL(
    (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()
  ),
  // Feature 30 — PWA manifest link
  manifest: "/manifest.json",
  applicationName: "AutoLenis",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AutoLenis",
  },
  formatDetection: { telephone: false },
};

// Feature 30 — PWA viewport / theme-color (Next.js 16 requires separate viewport export)
export const viewport: Viewport = {
  themeColor: "#0B5FD1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${plusJakartaSans.variable} ${inter.variable} font-[family-name:var(--font-heading)] antialiased`}>
        {/* Connected entity graph — sitewide knowledge-graph backbone */}
        <JsonLd id="ld-entity-graph" data={entityGraphSchema} />
        {/* Phase C0 — sitewide Organization schema (national content engine) */}
        <OrganizationSchema />
        {children}
        {/* Group 8 (8A) — records affiliate referral clicks sitewide */}
        <ReferralCapture />
        <Toaster richColors position="bottom-right" />
        {/* Feature 30 — PWA service worker registration */}
        <ServiceWorkerRegistration />
        {/* Microsoft Clarity session replay (production only, requires NEXT_PUBLIC_CLARITY_ID) */}
        <Clarity />
        {/* TikTok Pixel — loads sitewide (buyer, dealer, admin, public, LP pages) */}
        <TikTokPixel />
        {/* Cookie consent banner — sitewide, must be the last child of body */}
        <CookieBanner />
      </body>
    </html>
  );
}
