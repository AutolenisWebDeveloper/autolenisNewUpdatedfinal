import { requireDealer } from "@/lib/auth/dealer-session";
import { History } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ImportHistoryPage() {
  await requireDealer();

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="import-history-page">
      <div className="flex items-center gap-3 mb-6">
        <History size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Import History</h1>
      </div>

      <div className="text-center py-20 text-slate-400" data-testid="no-imports">
        <History size={40} className="mx-auto mb-4 text-slate-300" />
        <p className="font-semibold text-slate-600">No imports yet</p>
        <p className="text-sm mt-1">Use bulk upload to import vehicles from a CSV file.</p>
      </div>
    </div>
  );
}
