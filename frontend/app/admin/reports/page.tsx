import { requireAdmin } from "@/lib/auth/admin-session";
import Link from "next/link";
import { BarChart2 } from "lucide-react";
export default async function AdminReportsPage() {
  await requireAdmin();
  return <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-reports-page"><div className="flex items-center gap-3 mb-6"><BarChart2 size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Reports</h1></div><div className="grid grid-cols-2 gap-3">{[{href:"/admin/reports/funnel",label:"Conversion Funnel"},{href:"/admin/reports/affiliate",label:"Affiliate Performance"},{href:"/admin/reports/risk",label:"Deal Risk Intelligence"},{href:"/admin/reports/pipeline",label:"Revenue Pipeline"},{href:"/admin/activity",label:"Activity Feed"}].map(r=><Link key={r.href} href={r.href} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-al-primary/30 transition-colors text-sm font-medium text-slate-800">{r.label}</Link>)}</div></div>;
}
