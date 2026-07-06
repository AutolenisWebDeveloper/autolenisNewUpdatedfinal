import type { Metadata } from "next";

export const metadata: Metadata = { title: "Messages" };

// Feature 33 — Buyer Messages Page
// Lists buyer's message threads with admin. Real data from MessageThread model.
import { requireBuyer } from "@/lib/auth/session";
import { getBuyerMessageThreads } from "@/lib/services/messaging/messaging-data.service";
import { MessageSquare } from "lucide-react";
import Link from "next/link";
import BuyerMessageCompose from "@/components/buyer/BuyerMessageCompose";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const buyer = await requireBuyer();

  const threads = await getBuyerMessageThreads(buyer.userId);

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="messages-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Messages</h1>
        </div>
      </div>

      {/* New message compose */}
      <BuyerMessageCompose />

      {/* Thread list */}
      {threads.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-xl mt-4" data-testid="no-threads">
          <MessageSquare size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No messages yet.</p>
          <p className="text-slate-400 text-xs mt-1">Use the form above to send a message to support.</p>
        </div>
      ) : (
        <div className="space-y-2 mt-4">
          {threads.map(t => {
            const latestMsg = t.messages[0];
            const myParticipant = t.participants.find(p => p.userId === buyer.userId);
            const hasUnread =
              latestMsg &&
              (!myParticipant?.lastReadAt ||
                latestMsg.sentAt > myParticipant.lastReadAt) &&
              latestMsg.senderId !== buyer.userId;

            return (
              <Link
                key={t.id}
                href={`/buyer/messages/${t.id}`}
                data-testid={`thread-${t.id}`}
                className={`block bg-white border rounded-xl p-4 hover:border-al-primary/30 transition-colors ${
                  hasUnread ? "border-al-primary/50 bg-al-primary/5" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900 text-sm">
                        {t.dealId
                          ? `Deal #${t.dealId.slice(-8).toUpperCase()}`
                          : t.requestId
                          ? `Request #${t.requestId.slice(-8).toUpperCase()}`
                          : "Support"}
                      </p>
                      {hasUnread && (
                        <span className="inline-block w-2 h-2 rounded-full bg-al-primary" data-testid={`unread-dot-${t.id}`} />
                      )}
                    </div>
                    {latestMsg && (
                      <p className="text-xs text-slate-500 truncate mt-1">
                        {latestMsg.isRedacted ? "[Redacted]" : latestMsg.content}
                      </p>
                    )}
                  </div>
                  {t.lastMessageAt && (
                    <p className="text-xs text-slate-400 shrink-0">
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
