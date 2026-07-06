"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

export type VehicleRequestRow = {
  id: string;
  status: string;
  buyerName: string;
  email: string | null;
  paymentMethod: string | null;
  preApprovalStatus: string | null;
  make: string;
  model: string;
  maxBudgetCents: number | null;
  createdAt: string; // ISO string
  offerCount: number;
};

// Real VehicleRequestStatus enum values → display labels + badge tone.
const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "New",
  INTAKE: "In Review",
  ACTIVE_SOURCING: "Sourcing",
  OFFER_READY: "Offer Ready",
  OFFER_SENT: "Offer Sent",
  OFFER_ACCEPTED: "Offer Accepted",
  OFFER_DECLINED: "Offer Declined",
  DEAL_CREATED: "Deal Created",
  CLOSED_NO_MATCH: "Closed — No Match",
};

const STATUS_TONE: Record<string, string> = {
  SUBMITTED: "bg-blue-100 text-blue-700 border-blue-200",
  INTAKE: "bg-amber-100 text-amber-700 border-amber-200",
  ACTIVE_SOURCING: "bg-violet-100 text-violet-700 border-violet-200",
  OFFER_READY: "bg-cyan-100 text-cyan-700 border-cyan-200",
  OFFER_SENT: "bg-cyan-100 text-cyan-700 border-cyan-200",
  OFFER_ACCEPTED: "bg-green-100 text-green-700 border-green-200",
  OFFER_DECLINED: "bg-red-100 text-red-700 border-red-200",
  DEAL_CREATED: "bg-green-100 text-green-700 border-green-200",
  CLOSED_NO_MATCH: "bg-slate-100 text-slate-600 border-slate-200",
};

// Filter tabs map a label → the set of statuses it shows ([] === all).
const FILTERS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "all", label: "All", statuses: [] },
  { key: "new", label: "New", statuses: ["SUBMITTED"] },
  { key: "review", label: "In Review", statuses: ["INTAKE"] },
  { key: "sourcing", label: "Sourcing", statuses: ["ACTIVE_SOURCING"] },
  { key: "offer", label: "Offer Ready", statuses: ["OFFER_READY"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED_NO_MATCH"] },
];

function formatBudget(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

export default function VehicleRequestsListClient({
  requests,
}: {
  requests: VehicleRequestRow[];
}) {
  const [activeFilter, setActiveFilter] = useState("all");

  const active = FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0];
  const visible =
    active.statuses.length === 0
      ? requests
      : requests.filter((r) => active.statuses.includes(r.status));

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5" data-testid="vehicle-request-filters">
        {FILTERS.map((f) => {
          const count =
            f.statuses.length === 0
              ? requests.length
              : requests.filter((r) => f.statuses.includes(r.status)).length;
          const isActive = f.key === activeFilter;
          return (
            <button
              key={f.key}
              type="button"
              data-testid={`filter-tab-${f.key}`}
              onClick={() => setActiveFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                isActive
                  ? "bg-al-primary text-white border-al-primary"
                  : "bg-white text-slate-600 border-slate-200 hover:border-al-primary/40"
              }`}
            >
              {f.label}
              <span
                className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                  isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div
          className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center"
          data-testid="no-vehicle-requests"
        >
          <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700 mb-1">
            No vehicle requests in this view.
          </p>
          <p className="text-xs text-slate-500">
            Requests submitted at{" "}
            <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
              /request-vehicle
            </code>{" "}
            will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((req) => {
            const budget = formatBudget(req.maxBudgetCents);
            return (
              <Link
                key={req.id}
                href={`/admin/requests/${req.id}`}
                data-testid={`vehicle-request-row-${req.id}`}
                className="block bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-al-primary/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-900 text-sm truncate">
                        {req.buyerName || "Unknown"}
                      </p>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${
                          STATUS_TONE[req.status] ?? STATUS_TONE.SUBMITTED
                        }`}
                      >
                        {STATUS_LABEL[req.status] ?? req.status}
                      </span>
                      {req.offerCount > 0 && (
                        <span className="text-[10px] font-semibold rounded-full border border-violet-200 bg-violet-100 text-violet-700 px-2 py-0.5">
                          {req.offerCount} offer{req.offerCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {req.email ? (
                      <p className="text-xs text-slate-500 truncate">{req.email}</p>
                    ) : null}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {[req.make, req.model].filter(Boolean).join(" ")}
                      {budget ? ` · ${budget}` : ""}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Submitted {new Date(req.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-al-primary shrink-0">
                    View →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
