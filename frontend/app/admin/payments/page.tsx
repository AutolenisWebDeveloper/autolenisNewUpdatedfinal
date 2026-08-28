// /admin/payments — Admin payment operations page
// Covers deposit and concierge fee management.
// Server component — loads data server-side, renders action panels via AdminPaymentActionsClient.

import type { Metadata } from "next";
import { AdminRelatedLinks } from "@/components/admin/AdminRelatedLinks";
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
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Payment Hub</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage deposits, service fees, affiliate commissions, and refunds
          </p>
        </div>
        {/* Batch 2 IA: the searchable deposit and refund views used to be
            reachable only from a buyer record or a reconciliation row, so the
            Hub's own tabs were the only entry point an operator could find.
            These are their canonical parent links. */}
        <AdminRelatedLinks
          label="Payment views"
          links={[
            { href: "/admin/payments/deposits", label: "Deposits", testId: "deposits-link" },
            { href: "/admin/payments/refunds", label: "Refunds", testId: "refunds-link" },
            {
              href: "/admin/payments/reconciliation",
              label: "Reconciliation \u2192",
              testId: "reconciliation-link",
            },
          ]}
        />
      </div>
      <AdminPaymentsClient deposits={deposits} conciergeFees={conciergeFees} />
    </div>
  );
}
