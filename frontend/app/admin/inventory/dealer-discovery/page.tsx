// /admin/inventory/dealer-discovery — System 15 Dealer Discovery workflow
import { requireAdmin } from "@/lib/auth/admin-session";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export default async function AdminDealerDiscoveryPage() {
  await requireAdmin();
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-discovery-page">
      <div className="flex items-center gap-3 mb-6"><Users size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Dealer Discovery</h1></div>
      <p className="text-sm text-slate-500 mb-6">Identify dealers from inventory adapters who are not yet AutoLenis partners. Invite, contact, or decline.</p>
      <div className="text-center py-12 bg-white border border-slate-200 rounded-xl">
        <p className="text-slate-400 text-sm mb-4">Dealer discovery requires active inventory sync. Run a search first.</p>
        <Button variant="secondary" href="/admin/inventory/search-tool" data-testid="goto-search-tool">Run Inventory Search</Button>
      </div>
    </div>
  );
}
