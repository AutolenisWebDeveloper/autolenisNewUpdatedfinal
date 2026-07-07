// Feature 33 — Admin Thread Detail Page
// Admin views and replies to a buyer↔admin thread.

import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminMessageThread } from "@/lib/services/admin/admin-ops.service";
import { notFound } from "next/navigation";
import { MessageSquare, ArrowLeft } from "lucide-react";
import Link from "next/link";
import AdminMessageReply from "@/components/admin/AdminMessageReply";

export const dynamic = "force-dynamic";

export default async function AdminThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  await requireAdmin();
  const { threadId } = await params;

  const thread = await getAdminMessageThread(threadId);
  if (!thread) notFound();

  const buyer = thread.buyer;

  // Build a sender label map (userId → display label)
  const senderLabels = new Map<string, string>();
  if (buyer) senderLabels.set(buyer.userId, `${buyer.firstName} ${buyer.lastName}`);
  thread.participants
    .filter(p => p.role === "ADMIN")
    .forEach(p => senderLabels.set(p.userId, "Admin"));

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-thread-page">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/messages" className="text-slate-400 hover:text-slate-700" data-testid="back-to-admin-messages" aria-label="Back to all message threads">
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <MessageSquare size={20} className="text-al-primary" />
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            Thread — {buyer ? `${buyer.firstName} ${buyer.lastName}` : "Unknown Buyer"}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Status: {thread.status} · {thread.messages.length} message(s)
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-3 mb-6" data-testid="admin-thread-messages">
        {thread.messages.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8" data-testid="admin-thread-empty">
            No messages yet.
          </p>
        )}
        {thread.messages.map(msg => {
          const isAdmin = !buyer || msg.senderId !== buyer.userId;
          const senderLabel = senderLabels.get(msg.senderId) ?? (isAdmin ? "Admin" : "Buyer");

          return (
            <div
              key={msg.id}
              data-testid={`admin-message-${msg.id}`}
              className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  isAdmin
                    ? "bg-al-primary text-white rounded-br-sm"
                    : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                }`}
              >
                {msg.isRedacted ? (
                  <span className="italic opacity-70">[Message redacted]</span>
                ) : (
                  <p>{msg.content}</p>
                )}
                <p className={`text-xs mt-1.5 ${isAdmin ? "text-white/60" : "text-slate-400"}`}>
                  {senderLabel} · {new Date(msg.sentAt).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply */}
      {thread.status !== "CLOSED" ? (
        <AdminMessageReply threadId={threadId} />
      ) : (
        <div
          className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-sm text-slate-500"
          data-testid="admin-thread-closed"
        >
          This thread is closed.
        </div>
      )}
    </div>
  );
}
