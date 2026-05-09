import type { Metadata } from "next";

export const metadata: Metadata = { title: "Saved Searches" };

// Feature 20 — Saved Searches (max 3)
// Feature 24 — Buyer Activity Timeline
// Feature 25 — Buyer Referral Hub
// Feature 21 — Profile Completeness
// These pages share common buyer portal patterns

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Bookmark } from "lucide-react";
import SavedSearchDeleteButton from "@/components/buyer/SavedSearchDeleteButton";

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage() {
  const buyer = await requireBuyer();
  const searches = await prisma.savedSearch.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="saved-searches-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bookmark size={22} className="text-[#0B5FD1]" />
          <h1 className="text-xl font-bold text-slate-900">Saved Searches</h1>
        </div>
        <p className="text-xs text-slate-400">{searches.length}/3 max</p>
      </div>
      {searches.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-xl" data-testid="no-saved-searches">
          <p className="text-slate-500 mb-2">No saved searches</p>
          <p className="text-xs text-slate-400">Save searches from the inventory page to get alerts when new matches arrive.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {searches.map((s) => (
            <div key={s.id} data-testid={`saved-search-${s.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{s.name}</p>
                {s.matchCount > 0 && <p className="text-xs text-green-600 mt-0.5">{s.matchCount} new matches</p>}
              </div>
              <SavedSearchDeleteButton searchId={s.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
