// /admin/support — System 13 support tools.
// Audited impersonation sessions over the existing (previously orphaned)
// /api/admin/support/impersonate + …/impersonation/[id]/end routes:
// who / why / when is recorded per session; start requires a reason and the
// routes are SUPER_ADMIN gated server-side (ruled policies 1 and 4).
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { LifeBuoy, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  StartImpersonationButton,
  EndImpersonationButton,
} from "@/components/admin/SupportImpersonationActions";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const admin = await requireAdmin();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const [sessions, matches] = await Promise.all([
    prisma.adminImpersonation.findMany({ orderBy: { startedAt: "desc" }, take: 25 }),
    query
      ? prisma.user.findMany({
          where: {
            OR: [
              { email: { contains: query, mode: "insensitive" } },
              { buyer: { firstName: { contains: query, mode: "insensitive" } } },
              { buyer: { lastName: { contains: query, mode: "insensitive" } } },
            ],
          },
          select: {
            id: true,
            email: true,
            role: true,
            buyer: { select: { firstName: true, lastName: true } },
          },
          take: 20,
        })
      : Promise.resolve([]),
  ]);

  // Resolve emails for session target users + acting admins.
  const targetIds = Array.from(new Set(sessions.map((s) => s.targetUserId)));
  const adminIds = Array.from(new Set(sessions.map((s) => s.adminId)));
  const [targets, admins] = await Promise.all([
    targetIds.length
      ? prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, email: true } })
      : Promise.resolve([]),
    adminIds.length
      ? prisma.admin.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, user: { select: { email: true } } },
        })
      : Promise.resolve([]),
  ]);
  const targetEmail = new Map(targets.map((u) => [u.id, u.email]));
  const adminEmail = new Map(admins.map((a) => [a.id, a.user.email]));

  const active = sessions.filter((s) => s.status === "ACTIVE");
  const past = sessions.filter((s) => s.status !== "ACTIVE");

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-support-page">
      <div className="flex items-center gap-3 mb-2">
        <LifeBuoy size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Support Tools</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Audited support sessions — every session records who, why, and when in the audit log.
        Only Super Admin and Support Admin can start or end sessions.
      </p>

      {/* User search */}
      <form method="GET" className="mb-6" data-testid="support-search-form">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search users by email or name…"
            aria-label="Search users by email or name"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20"
            data-testid="support-search-input"
          />
        </div>
      </form>

      {query && (
        <section className="mb-8" data-testid="support-search-results">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Results for “{query}” ({matches.length})
          </h2>
          {matches.length === 0 ? (
            <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-5">No users match.</p>
          ) : (
            <div className="space-y-2">
              {matches.map((u) => {
                const name = u.buyer ? `${u.buyer.firstName} ${u.buyer.lastName}` : null;
                return (
                  <div key={u.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-3.5" data-testid={`support-user-${u.id}`}>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{name ?? u.email}</p>
                      <p className="text-xs text-slate-400">{u.email} · {u.role}</p>
                    </div>
                    <StartImpersonationButton targetUserId={u.id} targetLabel={name ?? u.email} adminRole={admin.role} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Active sessions */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Active Sessions ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-5" data-testid="no-active-sessions">
            No active support sessions.
          </p>
        ) : (
          <div className="space-y-2">
            {active.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-white border-2 border-amber-200 rounded-xl px-5 py-3.5" data-testid={`session-${s.id}`}>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{targetEmail.get(s.targetUserId) ?? s.targetUserId}</p>
                  <p className="text-xs text-slate-400">
                    By {adminEmail.get(s.adminId) ?? s.adminId} · started {s.startedAt.toLocaleString()} · {s.reason}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="amber" className="text-xs">ACTIVE</Badge>
                  <EndImpersonationButton sessionId={s.id} adminRole={admin.role} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent history */}
      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Recent Sessions</h2>
        {past.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-5">No past sessions.</p>
        ) : (
          <div className="space-y-2">
            {past.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-3" data-testid={`session-${s.id}`}>
                <div>
                  <p className="text-sm text-slate-800">{targetEmail.get(s.targetUserId) ?? s.targetUserId}</p>
                  <p className="text-xs text-slate-400">
                    By {adminEmail.get(s.adminId) ?? s.adminId} · {s.startedAt.toLocaleDateString()}
                    {s.endedAt ? ` → ${s.endedAt.toLocaleDateString()}` : ""} · {s.reason}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">{s.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
