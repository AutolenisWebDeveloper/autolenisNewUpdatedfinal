// /admin/finance — Admin Finance Dashboard
// Real-time 4-card summary + monthly revenue trend chart (Recharts).
// Pulls from GET /api/admin/reports/financial-summary.

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { DollarSign, TrendingUp, TrendingDown, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

interface MonthPoint {
  month: string;
  deposits: number;
  fees: number;
  net: number;
}

interface FinancialSummary {
  depositsCollected: number;
  depositsRefunded: number;
  feesCollected: number;
  feesRefunded: number;
  feeRefundCount: number;
  netRevenue: number;
  depositCount: number;
  feeCount: number;
  monthlyTrend: MonthPoint[];
  generatedAt: string;
}

function cents(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n / 100);
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "green" | "red" | "blue";
  icon: React.ElementType;
  testid: string;
}) {
  const colors = {
    green:  { ring: "border-green-200",  bg: "bg-green-50",  text: "text-green-700",  icon: "text-green-600"  },
    red:    { ring: "border-red-200",    bg: "bg-red-50",    text: "text-red-700",    icon: "text-red-500"    },
    blue:   { ring: "border-[#DBEAFE]",  bg: "bg-al-primary-subtle", text: "text-al-primary", icon: "text-al-primary"  },
  };
  const c = colors[accent];
  return (
    <div data-testid={testid}
      className={`bg-white border-2 ${c.ring} rounded-2xl p-6 flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center`}>
          <Icon size={18} className={c.icon} />
        </div>
      </div>
      <p className={`text-3xl font-black ${c.text}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// Custom chart tooltip
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-bold text-slate-800 mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="text-xs">
          {p.name}: {cents(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function AdminFinancePage() {
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ summary: FinancialSummary }>("/api/admin/reports/financial-summary");
      setData(data.summary);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to load summary"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Normalise monthly chart values to dollars for display
  const chartData = (data?.monthlyTrend ?? []).map(m => ({
    month: m.month,
    "Deposits ($)":  Math.round(m.deposits / 100),
    "Fees ($)":      Math.round(m.fees     / 100),
    "Net ($)":       Math.round(m.net      / 100),
  }));

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-finance-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <DollarSign size={22} className="text-al-primary" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Finance Dashboard</h1>
            {data?.generatedAt && (
              <p className="text-xs text-slate-400">Last updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          data-testid="finance-refresh-btn"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3" data-testid="finance-error">
          <AlertTriangle size={18} className="text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="flex items-center justify-center py-24" data-testid="finance-loading">
          <Loader2 size={28} className="animate-spin text-al-primary" />
        </div>
      )}

      {data && (
        <>
          {/* 4 KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Deposits Collected"
              value={cents(data.depositsCollected)}
              sub={`${data.depositCount} paid deposit${data.depositCount !== 1 ? "s" : ""}`}
              accent="green"
              icon={TrendingUp}
              testid="finance-card-deposits-collected"
            />
            <MetricCard
              label="Deposits Refunded"
              value={cents(data.depositsRefunded)}
              sub="Total $99 deposits returned"
              accent="red"
              icon={TrendingDown}
              testid="finance-card-deposits-refunded"
            />
            <MetricCard
              label="Concierge Fees Collected"
              value={cents(data.feesCollected)}
              sub={`${data.feeCount} Premium deal${data.feeCount !== 1 ? "s" : ""}`}
              accent="blue"
              icon={DollarSign}
              testid="finance-card-fees-collected"
            />
            <MetricCard
              label="Net Revenue"
              value={cents(data.netRevenue)}
              sub="Deposits + fees − all refunds"
              accent="blue"
              icon={TrendingUp}
              testid="finance-card-net-revenue"
            />
          </div>

          {/* Monthly Revenue Trend */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6" data-testid="finance-monthly-chart">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-5">
              Monthly Revenue Trend — Last 12 Months
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${v}`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar dataKey="Deposits ($)"   fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Fees ($)"       fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Net ($)"        fill="#0B5FD1" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
            {data.monthlyTrend.every(m => m.net === 0) && (
              <p className="text-center text-sm text-slate-400 mt-4" data-testid="finance-chart-empty">
                No revenue data yet — transactions will appear as they come in.
              </p>
            )}
          </div>

          {/* Refund summary row */}
          {(data.feesRefunded > 0) && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3" data-testid="finance-refund-alert">
              <TrendingDown size={16} className="text-amber-600 shrink-0" />
              <p className="text-sm text-amber-900">
                <strong>{cents(data.feesRefunded)}</strong> in concierge fees refunded across {data.feeRefundCount} deal{data.feeRefundCount !== 1 ? "s" : ""}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
