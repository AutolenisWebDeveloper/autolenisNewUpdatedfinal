// /admin/payments — Admin payment operations page
// Covers deposit and concierge fee management.
// Server component — loads data server-side, renders action panels via AdminPaymentActionsClient.

import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminDepositList, getAdminConciergeFeeList } from "@/lib/services/admin/admin-payments.service";
import AdminPaymentsClient from "./AdminPaymentsClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payments — Admin",
};

export default async function AdminPaymentsPage() {
  await requireAdmin();

  const [deposits, conciergeFees] = await Promise.all([
    getAdminDepositList(),
    getAdminConciergeFeeList(),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="admin-payments-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Payments</h1>
        <p className="text-sm text-slate-500 mt-0.5">Deposit and concierge fee management</p>
      </div>
      <AdminPaymentsClient deposits={deposits} conciergeFees={conciergeFees} />
    </div>
  );
}
