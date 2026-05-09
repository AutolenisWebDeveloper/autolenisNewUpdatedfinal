// /admin/pickups — Gap Group 4.1 — platform-wide pickup management

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { MapPin, AlertTriangle } from "lucide-react";
import { AdminPickupListActions } from "@/components/admin/AdminPickupListActions";

export const dynamic = "force-dynamic";
export default async function AdminPickupsPage() {
  await requireAdmin();

  let pickups: Awaited<ReturnType<typeof prisma.pickup.findMany<{ include: { deal: { include: { buyer: true } } } }>>> = [];
  let loadError: string | null = null;

  try {
    pickups = await prisma.pickup.findMany({
      include: { deal: { include: { buyer: true } } },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading pickups";
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-pickups-page">
      <div className="flex items-center gap-3 mb-6"><MapPin size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Pickup Management</h1></div>
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="pickups-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load pickups</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}
      {!loadError && pickups.length === 0 ? (
        <div className="text-center py-12 text-slate-400" data-testid="no-pickups">No pickups scheduled yet</div>
      ) : (
        <div className="space-y-2">
          {pickups.map(p => (
            <div key={p.id} data-testid={`pickup-row-${p.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{p.deal?.buyer?.firstName ?? ""} {p.deal?.buyer?.lastName ?? ""}</p>
                <p className="text-xs text-slate-400">
                  {p.scheduledAt ? p.scheduledAt.toLocaleDateString() : "Not scheduled"} · {p.location ?? "Location TBD"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={p.status === "COMPLETED" ? "green" : p.status === "SCHEDULED" ? "blue" : "secondary"} className="text-xs">{p.status.replace(/_/g, " ")}</Badge>
                <AdminPickupListActions pickupId={p.id} pickupStatus={p.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
