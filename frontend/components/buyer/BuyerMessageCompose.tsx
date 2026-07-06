"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, MessageSquare } from "lucide-react";

// Feature 33 — Buyer starts a new support message thread
export default function BuyerMessageCompose() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/buyer/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { thread?: { id: string } };
        error?: { message: string };
      };
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? "Failed to send message. Please try again.");
        return;
      }
      setContent("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="buyer-message-compose">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          data-testid="compose-new-message-btn"
          className="inline-flex items-center gap-2 px-4 py-2 bg-al-primary text-white rounded-xl text-sm font-semibold hover:bg-al-primary transition-colors"
        >
          <MessageSquare size={15} />
          New Message
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-4"
          data-testid="compose-form"
        >
          <p className="text-sm font-semibold text-slate-800 mb-3">Send a message to support</p>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="How can we help you today?"
            rows={4}
            maxLength={4000}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
            data-testid="compose-textarea"
          />
          {error && (
            <p className="text-xs text-red-600 mt-1" data-testid="compose-error">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => { setOpen(false); setContent(""); setError(null); }}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
              data-testid="compose-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-al-primary text-white rounded-lg text-xs font-semibold hover:bg-al-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="compose-submit-btn"
            >
              <Send size={12} />
              {submitting ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
