"use client";

import { useState } from "react";
import type { DepositRow, ConciergeFeeRow } from "@/lib/services/admin/admin-payments.service";
import AdminPaymentActionsClient from "@/components/admin/AdminPaymentActionsClient";

interface Props {
  deposits: DepositRow[];
  conciergeFees: ConciergeFeeRow[];
}

type DepositFilter = "ALL" | "PENDING" | "PAID" | "REFUNDED" | "WAIVED";
type FeeFilter = "ALL" | "PENDING" | "PAID" | "REFUNDED";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

export default function AdminPaymentsClient({ deposits, conciergeFees }: Props) {
  const [tab, setTab] = useState<"deposits" | "fees">("deposits");
  const [depositFilter, setDepositFilter] = useState<DepositFilter>("ALL");
  const [feeFilter, setFeeFilter] = useState<FeeFilter>("ALL");

  const filteredDeposits = deposits.filter(
    (d) => depositFilter === "ALL" || d.status === depositFilter,
  );

  const filteredFees = conciergeFees.filter(
    (d) => feeFilter === "ALL" || d.feeStatus === feeFilter,
  );

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["deposits", "fees"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-[#0B5FD1] text-[#0B5FD1]"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t === "deposits" ? `Deposits (${deposits.length})` : `Concierge Fees (${conciergeFees.length})`}
          </button>
        ))}
      </div>

      {/* Deposits tab */}
      {tab === "deposits" && (
        <div>
          {/* Filter pills */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(["ALL", "PENDING", "PAID", "REFUNDED", "WAIVED"] as DepositFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setDepositFilter(f)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  depositFilter === f
                    ? "bg-[#0B5FD1] text-white border-[#0B5FD1]"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {filteredDeposits.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
              No deposits found.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Table header */}
              <div className="hidden md:grid grid-cols-[1fr_1.5fr_80px_100px_1fr_1fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                {["Buyer", "Email", "Amount", "Status", "Created", "Actions"].map((h) => (
                  <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                ))}
              </div>
              {filteredDeposits.map((d, i) => (
                <div
                  key={d.depositId}
                  className={`grid md:grid-cols-[1fr_1.5fr_80px_100px_1fr_1fr] gap-3 px-5 py-4 items-center ${i < filteredDeposits.length - 1 ? "border-b border-slate-50" : ""} hover:bg-slate-50/60 transition-colors`}
                >
                  <span className="text-sm font-semibold text-slate-800 truncate">{d.buyerName}</span>
                  <span className="text-xs text-slate-500 truncate">{d.buyerEmail}</span>
                  <span className="text-sm font-semibold text-slate-800">{fmtCents(d.amountCents)}</span>
                  <div>
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border ${
                      d.status === "PAID" ? "bg-green-100 text-green-700 border-green-200" :
                      d.status === "PENDING" ? "bg-amber-100 text-amber-700 border-amber-200" :
                      d.status === "REFUNDED" ? "bg-red-100 text-red-700 border-red-200" :
                      "bg-slate-100 text-slate-600 border-slate-200"
                    }`}>{d.status}</span>
                  </div>
                  <span className="text-xs text-slate-500">{fmtDate(d.createdAt)}</span>
                  <div>
                    <AdminPaymentActionsClient
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
      )}

      {/* Concierge Fees tab */}
      {tab === "fees" && (
        <div>
          {/* Filter pills */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(["ALL", "PENDING", "PAID", "REFUNDED"] as FeeFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFeeFilter(f)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  feeFilter === f
                    ? "bg-[#0B5FD1] text-white border-[#0B5FD1]"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {filteredFees.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
              No concierge fees found.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Table header */}
              <div className="hidden md:grid grid-cols-[1fr_1.5fr_80px_100px_1fr_1fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                {["Buyer", "Email", "Amount", "Status", "Fee Paid", "Actions"].map((h) => (
                  <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</span>
                ))}
              </div>
              {filteredFees.map((d, i) => (
                <div
                  key={d.dealId}
                  className={`grid md:grid-cols-[1fr_1.5fr_80px_100px_1fr_1fr] gap-3 px-5 py-4 items-center ${i < filteredFees.length - 1 ? "border-b border-slate-50" : ""} hover:bg-slate-50/60 transition-colors`}
                >
                  <span className="text-sm font-semibold text-slate-800 truncate">{d.buyerName}</span>
                  <span className="text-xs text-slate-500 truncate">{d.buyerEmail}</span>
                  <span className="text-sm font-semibold text-slate-800">{fmtCents(d.amountCents)}</span>
                  <div>
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border ${
                      d.feeStatus === "PAID" ? "bg-green-100 text-green-700 border-green-200" :
                      d.feeStatus === "PENDING" ? "bg-amber-100 text-amber-700 border-amber-200" :
                      "bg-red-100 text-red-700 border-red-200"
                    }`}>{d.feeStatus}</span>
                  </div>
                  <span className="text-xs text-slate-500">{d.feePaidAt ? fmtDate(d.feePaidAt) : "—"}</span>
                  <div>
                    <AdminPaymentActionsClient
                      type="concierge_fee"
                      dealId={d.dealId}
                      buyerId={d.buyerId}
                      buyerEmail={d.buyerEmail}
                      feeStatus={d.feeStatus}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
