// /admin/inventory/dealer-discovery — System 15 Dealer Discovery workflow
// Candidates are derived from real synced inventory: external dealer names on
// inventory items that don't match an onboarded AutoLenis dealer.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDealerDiscoveryPage() {
  await requireAdmin();

  const [externalGroups, partners] = await Promise.all([
    prisma.inventoryItem.groupBy({
      by: ["externalDealerName", "externalDealerCity", "externalDealerState"],
      where: { externalDealerName: { not: null }, isActive: true },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 100,
    }),
    prisma.dealer.findMany({ select: { dealershipName: true } }),
  ]);

  const partnerNames = new Set(partners.map(p => p.dealershipName.trim().toLowerCase()));
  const candidates = externalGroups
    .filter(g => g.externalDealerName && !partnerNames.has(g.externalDealerName.trim().toLowerCase()))
    .map(g => ({
      name: g.externalDealerName as string,
      city: g.externalDealerCity,
      state: g.externalDealerState,
      inventoryCount: g._count.id,
    }));

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-discovery-page">
      <div className="flex items-center gap-3 mb-6"><Users size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Dealer Discovery</h1></div>
      <p className="text-sm text-slate-500 mb-6">
        Dealers appearing in synced inventory who are not yet AutoLenis partners, ranked by active listing count.
        Recruit them via <a href="/admin/dealer-outreach" className="text-al-primary hover:underline">Dealer Recruitment</a> or invite directly.
      </p>
      {candidates.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-xl" data-testid="dealer-discovery-empty">
          <p className="text-slate-500 text-sm font-medium mb-1">No unpartnered dealers found in synced inventory</p>
          <p className="text-slate-400 text-xs mb-4">Candidates appear here when inventory sync brings in vehicles from external dealers.</p>
          <Button variant="secondary" href="/admin/inventory/search-tool" data-testid="goto-search-tool">Run Inventory Search</Button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Dealer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Location</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Active Listings</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {candidates.map(c => (
                <tr key={`${c.name}-${c.city ?? ""}`} data-testid={`discovery-row-${c.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-500">{c.city ? `${c.city}, ${c.state ?? ""}` : "—"}</td>
                  <td className="px-4 py-3">{c.inventoryCount}</td>
                  <td className="px-4 py-3 text-right">
                    <a href="/admin/dealers/invite" className="text-al-primary text-xs font-medium hover:underline">Invite →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
