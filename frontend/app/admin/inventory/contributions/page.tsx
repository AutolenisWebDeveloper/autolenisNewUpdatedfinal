import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDealerContributionsPage() {
  await requireAdmin();
  // ENH-19: Dealer contribution analytics
  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE" },
    include: { _count: { select: { inventory: true, offers: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="dealer-contributions-page">
      <div className="flex items-center gap-3 mb-6"><Users size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Dealer Contributions</h1></div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>{["Dealer","Tier","Inventory","Offers","Load"].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dealers.map(d => (
              <tr key={d.id} data-testid={`contribution-${d.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{d.dealershipName}</td>
                <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{d.tier}</span></td>
                <td className="px-4 py-3">{d._count.inventory}</td>
                <td className="px-4 py-3">{d._count.offers}</td>
                <td className="px-4 py-3">{d.currentAuctionLoad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
