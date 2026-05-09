// Feature 33 — Admin Messages Page
// Lists all buyer↔admin message threads. Admins can view and reply to any thread.

import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminMessageThreads } from "@/lib/services/admin/admin-ops.service";
import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AdminMessagesPage() {
  await requireAdmin();

  const enriched = await getAdminMessageThreads();

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-messages-page">
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare size={22} className="text-[#0B5FD1]" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Messages</h1>
          <p className="text-xs text-slate-400 mt-0.5">Buyer↔Admin threads · Feature 33</p>
        </div>
      </div>

      {enriched.length === 0 ? (
        <div
          className="bg-white border border-slate-200 rounded-xl p-12 text-center"
          data-testid="admin-messages-empty"
        >
          <MessageSquare size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No message threads yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {enriched.map(t => {
            const latestMsg = t.messages[0];
            return (
              <Link
                key={t.id}
                href={`/admin/messages/${t.id}`}
                data-testid={`admin-thread-${t.id}`}
                className="flex items-start justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-[#0B5FD1]/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-slate-900 text-sm">
                      {t.buyer
                        ? `${t.buyer.firstName} ${t.buyer.lastName}`
                        : "Unknown Buyer"}
                    </p>
                    <Badge
                      variant={
                        t.status === "ACTIVE"
                          ? "green"
                          : t.status === "FLAGGED"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {t.status}
                    </Badge>
                  </div>
                  {latestMsg && (
                    <p className="text-xs text-slate-500 truncate">
                      {latestMsg.isRedacted ? "[Redacted]" : latestMsg.content}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right ml-4">
                  {t.lastMessageAt && (
                    <p className="text-xs text-slate-400">
                      {new Date(t.lastMessageAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
