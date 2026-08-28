// /admin/compliance/ofac — OFAC review queue.
// Lists every pre-qualification under OFAC review or escalated, with the
// clear / escalate actions. Read-bounded (take: 100) — no unbounded query.
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import OfacReviewActions from "@/components/admin/OfacReviewActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "OFAC Review — Admin" };

export default async function AdminOfacPage() {
  const admin = await requireAdmin();

  const hits = await prisma.preQualification.findMany({
    where: { decision: { in: ["OFAC_REVIEW", "OFAC_ESCALATED"] } },
    include: { buyer: { select: { firstName: true, lastName: true, user: { select: { email: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-ofac-page">
      <div className="flex items-center gap-3 mb-2">
        <ShieldAlert size={22} className="text-red-600" />
        <h1 className="text-xl font-bold text-slate-900">OFAC Review <span className="text-slate-400 font-normal text-sm">({hits.length})</span></h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Buyer progress is frozen until each hit is cleared. Clearing resumes the buyer automatically; escalation routes the hit to legal.
      </p>

      {hits.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center" data-testid="ofac-empty">
          <ShieldAlert size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No OFAC reviews pending. All clear.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {hits.map(h => {
            const escalated = h.decision === "OFAC_ESCALATED";
            return (
              <div key={h.id} data-testid={`ofac-row-${h.id}`} className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">
                      {h.buyer.firstName} {h.buyer.lastName}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Buyer · {h.buyer.user?.email ?? "no email"} · hit {new Date(h.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={escalated ? "destructive" : "amber"} className="text-xs">
                    {escalated ? "Escalated to legal" : "Pending review"}
                  </Badge>
                </div>
                <div className="mt-3">
                  <OfacReviewActions prequalId={h.id} decision={h.decision} adminRole={admin.role} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
