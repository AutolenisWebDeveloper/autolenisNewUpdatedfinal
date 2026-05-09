import { requireAdmin } from "@/lib/auth/admin-session";
import { addSupportNote, getSupportNotes } from "@/lib/services/admin/admin-support.service";
import { LifeBuoy } from "lucide-react";
export default async function AdminSupportPage() {
  await requireAdmin();
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-support-page">
      <div className="flex items-center gap-3 mb-6">
        <LifeBuoy size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Support Tools</h1>
      </div>
      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="font-semibold text-slate-800 text-sm mb-2">Buyer Impersonation</p>
          <p className="text-sm text-slate-500 mb-3">
            Start an impersonation session to view a buyer account from their perspective. All sessions are logged.
          </p>
          <div className="mt-3 space-y-2" data-testid="impersonation-disabled-notice">
            <p className="text-xs text-amber-600 font-medium">
              ⚠️ Impersonation UI is not yet implemented. Use the API directly for now.
            </p>
            <code className="block text-xs bg-slate-100 rounded px-2 py-1 font-mono text-slate-700">
              POST /api/admin/support/impersonate {JSON.stringify({ targetUserId: "...", reason: "..." })}
            </code>
            <code className="block text-xs bg-slate-100 rounded px-2 py-1 font-mono text-slate-700">
              POST /api/admin/support/impersonation/[id]/end
            </code>
            <p className="text-xs text-slate-400">
              TODO: Add target user search + reason input + end-session button.
            </p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="font-semibold text-slate-800 text-sm mb-2">Support Notes</p>
          <p className="text-sm text-slate-500">
            Add internal notes to buyer or dealer accounts for support tracking.
          </p>
        </div>
      </div>
    </div>
  );
}
