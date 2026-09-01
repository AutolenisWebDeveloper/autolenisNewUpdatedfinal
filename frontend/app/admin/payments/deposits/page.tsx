// /admin/payments/deposits — Standalone deposits list (filterable)
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminDepositList } from "@/lib/services/admin/admin-payments.service";
import AdminPaymentActionsClient from "@/components/admin/AdminPaymentActionsClient";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deposits — Admin",
};

interface SP {
  searchParams: Promise<{ status?: string; q?: string }>;
}

const STATUSES = ["ALL", "PENDING", "PAID", "REFUNDED", "FAILED"] as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

export default async function AdminDepositsPage({ searchParams }: SP) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const status = (sp.status?.toUpperCase() ?? "ALL").trim();
  const q = (sp.q ?? "").trim().toLowerCase();

  const all = await getAdminDepositList();
  const filtered = all.filter((d) => {
    if (status !== "ALL" && d.status !== status) return false;
    if (q && !d.buyerEmail.toLowerCase().includes(q) && !d.buyerName.toLowerCase().includes(q)) return false;
    return true;
  });

  const totalPaidCents = all
    .filter((d) => d.status === "PAID")
    .reduce((sum, d) => sum + d.amountCents, 0);
  const refundedCount = all.filter((d) => d.status === "REFUNDED").length;

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="admin-deposits-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Deposits</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {all.length} deposit{all.length !== 1 ? "s" : ""} · {fmtCents(totalPaidCents)} collected ·{" "}
          {refundedCount} refunded
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {STATUSES.map((s) => {
          const isActive = (status === s) || (status === "ALL" && s === "ALL");
          const href = s === "ALL" ? "/admin/payments/deposits" : `/admin/payments/deposits?status=${s}`;
          return (
            <Link
              key={s}
              href={href}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                isActive
                  ? "bg-al-primary text-white border-al-primary"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`deposit-filter-${s.toLowerCase()}`}
            >
              {s}
            </Link>
          );
        })}
        <Link
          href="/admin/payments"
          className="ml-auto text-xs text-slate-500 hover:text-al-primary hover:underline"
          data-testid="deposits-back-to-payments"
        >
          ← Back to Payments
        </Link>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm" data-testid="deposits-empty">
          No deposits match this filter.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_1.5fr_80px_100px_1fr_1fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
            {["Buyer", "Email", "Amount", "Status", "Created", "Actions"].map((h) => (
              <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                {h}
              </span>
            ))}
          </div>
          {filtered.map((d, i) => (
            <div
              key={d.depositId}
              className={`grid md:grid-cols-[1fr_1.5fr_80px_100px_1fr_1fr] gap-3 px-5 py-4 items-center ${
                i < filtered.length - 1 ? "border-b border-slate-50" : ""
              } hover:bg-slate-50/60 transition-colors`}
              data-testid={`deposit-row-${d.depositId}`}
            >
              <Link
                href={`/admin/buyers/${d.buyerId}`}
                className="text-sm font-semibold text-slate-800 truncate hover:text-al-primary"
              >
                {d.buyerName}
              </Link>
              <span className="text-xs text-slate-500 truncate">{d.buyerEmail}</span>
              <span className="text-sm font-semibold text-slate-800">{fmtCents(d.amountCents)}</span>
              <div>
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border ${
                    d.status === "PAID"
                      ? "bg-green-100 text-green-700 border-green-200"
                      : d.status === "PENDING"
                      ? "bg-amber-100 text-amber-700 border-amber-200"
                      : d.status === "REFUNDED"
                      ? "bg-red-100 text-red-700 border-red-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}
                >
                  {d.status}
                </span>
              </div>
              <span className="text-xs text-slate-500">{fmtDate(d.createdAt)}</span>
              <div>
                <AdminPaymentActionsClient
                  adminRole={admin.role}
                  type="deposit"
                  depositId={d.depositId}
                  buyerId={d.buyerId}
                  buyerEmail={d.buyerEmail}
                  status={d.status}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
