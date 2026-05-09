import type { Metadata } from "next";

export const metadata: Metadata = { title: "Activity" };

// Feature 24 — Buyer Account Activity Timeline
// Plain language only — no internal labels visible

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const buyer = await requireBuyer();
  const events = await prisma.buyerActivityEvent.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="activity-page">
      <div className="flex items-center gap-3 mb-6">
        <Clock size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Account Activity</h1>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16 text-slate-400" data-testid="no-activity">
          <p>No activity yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} data-testid={`activity-event-${event.id}`}
              className="flex items-start gap-3 py-4 border-b border-slate-100 last:border-0">
              <div className="w-2 h-2 rounded-full bg-[#0B5FD1] mt-1.5 shrink-0" />
              <div>
                {/* Plain language title only — no internal event type labels */}
                <p className="text-sm font-medium text-slate-800">{event.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {event.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
