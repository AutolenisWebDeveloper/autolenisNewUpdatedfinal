import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminFaithMessagesPage() {
  await requireAdmin();
  const messages = await prisma.encouragementMessage.findMany({ orderBy: { placement: "asc" } });
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-faith-messages-page">
      <div className="flex items-center gap-3 mb-6"><MessageSquare size={20} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Encouragement Messages ({messages.length})</h1></div>
      <div className="space-y-2">
        {messages.length === 0 ? <p className="text-slate-400 text-sm">No messages yet</p> : messages.map(m => (
          <div key={m.id} data-testid={`message-row-${m.id}`} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <Badge variant="secondary" className="text-xs">{m.placement}</Badge>
              <Badge variant={m.isActive ? "green" : "gray"} className="text-xs">{m.isActive ? "Active" : "Inactive"}</Badge>
            </div>
            <p className="text-sm text-slate-700">{m.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
