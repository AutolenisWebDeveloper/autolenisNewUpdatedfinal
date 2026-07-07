"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, apiErrorMessage } from "@/lib/api/client";

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
        const { messages } = await api.get<{ messages: Message[] }>(`/api/dealer/messages/threads/${threadId}`);
        setMessages(messages ?? []);
      } catch (err) {
        setError(apiErrorMessage(err, "Failed to load messages."));
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
      const { message } = await api.post<{ message: Message }>(
        `/api/dealer/messages/threads/${threadId}`,
        { content: compose },
      );
      if (message) setMessages((prev) => [...prev, message]);
      setCompose("");
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to send message."));
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
          className="text-sm text-slate-400 hover:text-al-primary transition-colors"
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
                  ? "bg-al-primary text-white rounded-br-sm"
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
          className="flex-1 border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 resize-none"
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
          className="px-5 py-3 bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm"
          data-testid="send-btn"
        >
          {sending ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
