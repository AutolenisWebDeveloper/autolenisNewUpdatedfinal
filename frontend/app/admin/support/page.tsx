import { requireAdmin } from "@/lib/auth/admin-session";
import { LifeBuoy, Construction } from "lucide-react";

export default async function AdminSupportPage() {
  await requireAdmin();
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-support-page">
      <div className="flex items-center gap-3 mb-6">
        <LifeBuoy size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Support Tools</h1>
      </div>
      <div
        className="bg-white border border-slate-200 rounded-xl p-8 text-center"
        data-testid="impersonation-coming-soon"
      >
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 text-amber-600 mb-4">
          <Construction size={22} />
        </div>
        <p className="font-semibold text-slate-900 text-base mb-2">
          Buyer Impersonation — Coming Soon
        </p>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Secure buyer impersonation is currently in development. This feature
          will allow authorised support staff to view a buyer&apos;s account
          from their perspective with full session logging, time-bounded access
          and compliance-grade audit trails. It will be released in a future
          update once those controls are complete.
        </p>
      </div>
    </div>
  );
}
