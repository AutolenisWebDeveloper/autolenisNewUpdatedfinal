"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Message {
  id: string;
  content: string;
  senderRole?: string;
  senderId?: string;
  sentAt?: string;
  createdAt?: string;
}

export default function MessageThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [compose, setCompose] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/dealer/messages/threads/${threadId}`);
        if (!res.ok) {
          setError("Failed to load messages.");
          return;
        }
        const data = (await res.json()) as { messages?: Message[] };
        setMessages(data.messages ?? []);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!compose.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/dealer/messages/threads/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: compose }),
      });
      if (!res.ok) {
        setError("Failed to send message.");
        return;
      }
      const data = (await res.json()) as { message?: Message };
      if (data.message) {
        setMessages((prev) => [...prev, data.message!]);
      }
      setCompose("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function isDealer(msg: Message): boolean {
    return msg.senderRole === "DEALER" || msg.senderRole === "dealer";
  }

  function formatTime(msg: Message): string {
    const raw = msg.sentAt ?? msg.createdAt;
    if (!raw) return "";
    return new Date(raw).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl flex flex-col h-full" data-testid="message-thread-page">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dealer/messages"
          className="text-sm text-slate-400 hover:text-[#0B5FD1] transition-colors"
        >
          ← Messages
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Message Thread</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 min-h-[300px] max-h-[500px] overflow-y-auto space-y-3 mb-4"
        data-testid="messages-list"
      >
        {loading && (
          <p className="text-slate-400 text-sm text-center py-10">Loading messages...</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-10">No messages yet.</p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${isDealer(msg) ? "justify-end" : "justify-start"}`}
            data-testid={`message-${msg.id}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                isDealer(msg)
                  ? "bg-[#0B5FD1] text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-900 rounded-bl-sm"
              }`}
            >
              <p>{msg.content}</p>
              <p
                className={`text-[10px] mt-1 ${
                  isDealer(msg) ? "text-blue-100" : "text-slate-400"
                }`}
              >
                {formatTime(msg)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <form onSubmit={handleSend} className="flex gap-3 items-end" data-testid="compose-form">
        <textarea
          value={compose}
          onChange={(e) => setCompose(e.target.value)}
          placeholder="Type a message..."
          rows={2}
          className="flex-1 border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 resize-none"
          data-testid="compose-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={sending || !compose.trim()}
          className="px-5 py-3 bg-[#0B5FD1] hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm"
          data-testid="send-btn"
        >
          {sending ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
