import type { Metadata } from "next";
import { Suspense } from "react";
import ThankYouClient from "./ThankYouClient";

export const metadata: Metadata = {
  title: "Request Received — Activate Your Auction | AutoLenis",
  description:
    "Your vehicle request was received. Activate your private 48-hour dealer auction with a refundable $99 deposit. Verified dealers compete for your business.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
  openGraph: {
    title: "Request Received | AutoLenis",
    description:
      "Activate your private dealer auction. Verified dealers compete for your business within 48 hours.",
    siteName: "AutoLenis",
    type: "website",
  },
};

export default function ThankYouPage() {
  return (
    <Suspense fallback={null}>
      <ThankYouClient />
    </Suspense>
  );
}
