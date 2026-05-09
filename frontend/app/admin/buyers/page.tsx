import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminBuyerListData, getAdminBuyerKpis, type AdminBuyerKpis } from "@/lib/services/admin/admin-buyer-command-center.service";
import { AdminBuyersClient } from "./AdminBuyersClient";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const EMPTY_KPIS: AdminBuyerKpis = {
  total: 0,
  active: 0,
  pendingOnboarding: 0,
  prequalified: 0,
  withActiveDeals: 0,
  needingAction: 0,
  paymentIssues: 0,
  exceptionCases: 0,
};

export default async function AdminBuyersPage() {
  await requireAdmin();

  try {
    const [listData, kpis] = await Promise.all([
      getAdminBuyerListData({ page: 1, perPage: 50 }),
      getAdminBuyerKpis(),
    ]);

    return <AdminBuyersClient initialBuyers={listData.buyers} initialTotal={listData.total} kpis={kpis} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isMigrationError = message.includes("column") || message.includes("does not exist") || message.includes("archived_at") || message.includes("disabled_at") || message.includes("purged_at");
    return (
      <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-buyers-page">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={22} className="text-amber-600" />
          <h1 className="text-xl font-bold text-slate-900">Buyer Operations</h1>
        </div>
        {isMigrationError ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800 space-y-2">
            <p className="font-semibold">Database migration pending</p>
            <p className="text-sm">The buyer lifecycle fields (archived_at, disabled_at, purged_at) are not yet available in the production database.</p>
            <p className="text-sm">Run migration: <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">20260603000000_add_buyer_lifecycle_fields</code></p>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-800">
            <p className="font-semibold">Failed to load buyer data</p>
            <p className="text-sm mt-1 font-mono">{message}</p>
          </div>
        )}
        <div className="mt-4 opacity-50 pointer-events-none">
          <AdminBuyersClient initialBuyers={[]} initialTotal={0} kpis={EMPTY_KPIS} />
        </div>
      </div>
    );
  }
}
