import type { Metadata } from "next";

export const metadata: Metadata = { title: "Auction", robots: { index: false, follow: false } };

// Plural-path alias so /buyer/auctions/[id] also works (singular path is /buyer/auction/[id]).
// Some links/tests reference the plural path; this re-exports the same page component so
// both URLs render identically.

import AuctionDetailPage from "@/app/buyer/auction/[auctionId]/page";

export const dynamic = "force-dynamic";
export default AuctionDetailPage;
