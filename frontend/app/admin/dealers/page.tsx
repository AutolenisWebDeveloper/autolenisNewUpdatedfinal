import { requireAdmin } from "@/lib/auth/admin-session";
import {
  getAdminDealerListData,
  getAdminDealerKpis,
  type AdminDealerKpis,
} from "@/lib/services/admin/admin-dealer-command-center.service";
import { AdminDealersClient } from "./AdminDealersClient";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const EMPTY_KPIS: AdminDealerKpis = {
  total: 0, pending: 0, active: 0, suspended: 0, terminated: 0,
  withActiveAuctions: 0, withSubmittedOffers: 0, withWonDeals: 0,
  totalInventory: 0, complianceIssues: 0,
};

export default async function AdminDealersPage() {
  await requireAdmin();
  try {
    const [listData, kpis] = await Promise.all([
      getAdminDealerListData({ page: 1, perPage: 50 }),
      getAdminDealerKpis(),
    ]);
    return (
      <AdminDealersClient
        initialDealers={listData.dealers}
        initialTotal={listData.total}
        kpis={kpis}
      />
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return (
      <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-dealers-page">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={22} className="text-amber-600" />
          <h1 className="text-xl font-bold text-slate-900">Dealer Operations</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-800">
          <p className="font-semibold">Failed to load dealer data</p>
          <p className="text-sm mt-1 font-mono">{message}</p>
        </div>
        <div className="mt-4 opacity-50 pointer-events-none">
          <AdminDealersClient initialDealers={[]} initialTotal={0} kpis={EMPTY_KPIS} />
        </div>
      </div>
    );
  }
}
