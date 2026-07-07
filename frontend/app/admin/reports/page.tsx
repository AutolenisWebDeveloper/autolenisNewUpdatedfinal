import { requireAdmin } from "@/lib/auth/admin-session";
import Link from "next/link";
import { BarChart2 } from "lucide-react";

// Index of every report surface — each report route must be reachable from
// here (no URL-only reports).
const REPORT_GROUPS: Array<{ title: string; items: Array<{ href: string; label: string; note?: string }> }> = [
  {
    title: "Funnel & Pipeline",
    items: [
      { href: "/admin/reports/funnel", label: "Conversion Funnel" },
      { href: "/admin/reports/buyers", label: "Buyer Funnel", note: "date-scoped stages" },
      { href: "/admin/reports/pipeline", label: "Revenue Pipeline" },
      { href: "/admin/reports/risk", label: "Deal Risk Intelligence" },
    ],
  },
  {
    title: "Revenue & Partners",
    items: [
      { href: "/admin/reports/revenue", label: "Revenue" },
      { href: "/admin/reports/dealers", label: "Dealer Metrics" },
      { href: "/admin/reports/affiliates", label: "Affiliate Report", note: "date-scoped aggregate" },
      { href: "/admin/reports/affiliate", label: "Affiliate Performance", note: "per-affiliate + CSV" },
    ],
  },
  {
    title: "Activity",
    items: [
      { href: "/admin/activity", label: "Activity Feed" },
      { href: "/admin/audit-log", label: "Audit Log" },
    ],
  },
];

export default async function AdminReportsPage() {
  await requireAdmin();
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-reports-page">
      <div className="flex items-center gap-3 mb-6">
        <BarChart2 size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Reports</h1>
      </div>
      <div className="space-y-6">
        {REPORT_GROUPS.map(group => (
          <div key={group.title}>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{group.title}</h2>
            <div className="grid grid-cols-2 gap-3">
              {group.items.map(r => (
                <Link key={r.href} href={r.href} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-al-primary/30 transition-colors">
                  <span className="text-sm font-medium text-slate-800 block">{r.label}</span>
                  {r.note && <span className="text-xs text-slate-400">{r.note}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
