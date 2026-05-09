import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminAffiliateListData, getAdminAffiliateKpis, type AdminAffiliateKpis } from "@/lib/services/admin/admin-affiliate-command-center.service";
import AdminAffiliatesClient from "./AdminAffiliatesClient";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const EMPTY_KPIS: AdminAffiliateKpis = { total: 0, pending: 0, active: 0, suspended: 0, rejected: 0, totalReferrals: 0, convertedReferrals: 0, commissionsPendingCents: 0, commissionsPaidCents: 0, highPerforming: 0, complianceIssues: 0 };

export default async function AdminAffiliatesPage() {
  await requireAdmin();
  try {
    const [listData, kpis] = await Promise.all([
      getAdminAffiliateListData({ page: 1, perPage: 50 }),
      getAdminAffiliateKpis(),
    ]);
    return <AdminAffiliatesClient initialAffiliates={listData.affiliates} initialTotal={listData.total} kpis={kpis} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return (
      <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-affiliates-page">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={22} className="text-amber-600" />
          <h1 className="text-xl font-bold text-slate-900">Affiliates</h1>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-amber-800">Service Error</p>
          <p className="text-sm mt-1 font-mono">{message}</p>
        </div>
        <div className="mt-4 opacity-50 pointer-events-none">
          <AdminAffiliatesClient initialAffiliates={[]} initialTotal={0} kpis={EMPTY_KPIS} />
        </div>
      </div>
    );
  }
}
