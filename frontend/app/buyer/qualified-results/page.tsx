import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cars You Qualify For",
  // Private buyer surface — never indexed (autolenis-accessibility-performance-seo).
  robots: { index: false, follow: false },
};

import { requireBuyer } from "@/lib/auth/session";
import QualifiedResultsClient from "@/components/buyer/QualifiedResultsClient";

export const dynamic = "force-dynamic";

// QUAL (§8.1 row 4). The server component does authentication and hands the buyer's stored ZIP
// down as a starting point; every decision that matters — the approval gate, the headroom, the
// policy radius, the per-card action, and whether the market is even knowable — belongs to
// `lib/services/inventory/qualified-results.service.ts` and reaches the client through
// `/api/buyer/qualified-results`. Nothing here re-derives any of it.
export default async function QualifiedResultsPage() {
  const buyer = await requireBuyer();

  return (
    <div className="p-6 md:p-8" data-testid="qualified-results-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Cars you qualify for</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live from the market, filtered to what you are approved for and close enough for
          dealers to compete on.
        </p>
      </div>
      <QualifiedResultsClient initialZip={buyer.zip ?? null} />
    </div>
  );
}
