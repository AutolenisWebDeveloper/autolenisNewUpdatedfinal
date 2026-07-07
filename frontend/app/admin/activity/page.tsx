// Feature 18 — Platform Live Activity Feed
// Reads from existing BuyerActivityEvent + event ledger — no new event infrastructure required
// Liveness via <AutoRefresh/> RSC re-fetch polling (visibility-aware)

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Activity } from "lucide-react";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage() {
  await requireAdmin();

  const events = await prisma.buyerActivityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { buyer: { select: { firstName: true, lastName: true } } },
  });

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-activity-page">
      <div className="flex items-center gap-3 mb-6">
        <Activity size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Platform Activity Feed</h1>
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1" aria-hidden />
        <span className="text-xs text-slate-400">Live</span>
        <span className="ml-auto"><AutoRefresh intervalMs={30_000} /></span>
      </div>

      <div className="space-y-2" data-testid="activity-feed">
        {events.length === 0 ? (
          <div className="text-center py-16 text-slate-400" data-testid="no-activity">
            <p>No activity recorded yet</p>
          </div>
        ) : (
          events.map(event => (
            <div key={event.id} data-testid={`activity-event-${event.id}`}
              className="flex items-start justify-between bg-white border border-slate-100 rounded-xl px-5 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-al-primary mt-2 shrink-0" />
                <div>
                  {/* Plain language only — no internal event type labels */}
                  <p className="text-sm text-slate-800">{event.title}</p>
                  <p className="text-xs text-slate-400">{event.buyer.firstName} {event.buyer.lastName}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400 shrink-0 ml-4">
                {event.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
