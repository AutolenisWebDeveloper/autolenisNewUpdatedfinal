// Presentational helpers shared by the admin report pages. Server components —
// the date filter is a plain GET form (no client JS).
import { ArrowRight } from "lucide-react";

export function DateRangeForm({ fromInput, toInput }: { fromInput: string; toInput: string }) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-3 mb-6" data-testid="report-date-filter">
      <div>
        <label className="text-xs text-slate-500 font-medium mb-1 block">From</label>
        <input type="date" name="from" defaultValue={fromInput}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-2" />
      </div>
      <div>
        <label className="text-xs text-slate-500 font-medium mb-1 block">To</label>
        <input type="date" name="to" defaultValue={toInput}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-2" />
      </div>
      <button type="submit" className="text-xs font-medium px-3 py-2 rounded-lg bg-al-primary text-white" data-testid="report-apply">
        Apply
      </button>
    </form>
  );
}

export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? "text-slate-900"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// A labelled funnel/stage row with an optional conversion percentage vs the prior step.
export function FunnelRow({ label, count, prev, max }: { label: string; count: number; prev?: number; max: number }) {
  const width = Math.max(4, Math.round((count / Math.max(max, 1)) * 100));
  const conv = prev !== undefined && prev > 0 ? Math.round((count / prev) * 100) : null;
  return (
    <div data-testid={`funnel-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="flex items-center justify-between mb-1 text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="text-slate-500">
          {count.toLocaleString()}{conv !== null && <span className="text-slate-400 ml-2">({conv}% <ArrowRight size={10} className="inline" />)</span>}
        </span>
      </div>
      <div className="h-7 bg-slate-100 rounded-lg overflow-hidden">
        <div className="h-full bg-al-primary rounded-lg" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
