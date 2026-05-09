import type { Metadata } from "next";

export const metadata: Metadata = { title: "Message Thread", robots: { index: false, follow: false } };

// Feature 33 — Buyer Message Thread Detail
// Shows full conversation thread with admin. Buyer can reply.

import { requireBuyer } from "@/lib/auth/session";
import { getBuyerMessageThread } from "@/lib/services/messaging/messaging-data.service";
import { notFound } from "next/navigation";
import { MessageSquare, ArrowLeft } from "lucide-react";
import Link from "next/link";
import BuyerMessageReply from "@/components/buyer/BuyerMessageReply";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const buyer = await requireBuyer();
  const { threadId } = await params;

  const thread = await getBuyerMessageThread(buyer.userId, threadId);
  if (!thread) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="thread-page">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buyer/messages" className="text-slate-400 hover:text-slate-700" data-testid="back-to-messages">
          <ArrowLeft size={18} />
        </Link>
        <MessageSquare size={20} className="text-[#0B5FD1]" />
        <h1 className="text-lg font-bold text-slate-900">Support Thread</h1>
      </div>

      {/* Messages */}
      <div className="space-y-3 mb-6" data-testid="thread-messages">
        {thread.messages.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8" data-testid="thread-empty">
            No messages in this thread.
          </p>
        )}
        {thread.messages.map(msg => {
          const isMe = msg.senderId === buyer.userId;
          return (
            <div
              key={msg.id}
              data-testid={`message-${msg.id}`}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  isMe
                    ? "bg-[#0B5FD1] text-white rounded-br-sm"
                    : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                }`}
              >
                {msg.isRedacted ? (
                  <span className="italic opacity-70">[Message redacted]</span>
                ) : (
                  <p>{msg.content}</p>
                )}
                <p className={`text-xs mt-1.5 ${isMe ? "text-white/60" : "text-slate-400"}`}>
                  {isMe ? "You" : "Support"} · {new Date(msg.sentAt).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply box */}
      {thread.status !== "CLOSED" ? (
        <BuyerMessageReply threadId={threadId} />
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-sm text-slate-500" data-testid="thread-closed">
          This thread has been closed. Start a new message to contact support.
        </div>
      )}
    </div>
  );
}
