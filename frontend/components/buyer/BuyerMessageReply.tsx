"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

interface Props {
  threadId: string;
}

// Feature 33 — Buyer replies in an existing thread
export default function BuyerMessageReply({ threadId }: Props) {
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
        body: JSON.stringify({ content: content.trim(), threadId }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: { message: string };
      };
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? "Failed to send message. Please try again.");
        return;
      }
      setContent("");
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-4"
      data-testid="reply-form"
    >
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Type your reply…"
        rows={3}
        maxLength={4000}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
        data-testid="reply-textarea"
      />
      {error && (
        <p className="text-xs text-red-600 mt-1" data-testid="reply-error">
          {error}
        </p>
      )}
      <div className="flex justify-end mt-3">
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-al-primary text-white rounded-lg text-xs font-semibold hover:bg-al-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="reply-submit-btn"
        >
          <Send size={12} />
          {submitting ? "Sending…" : "Send Reply"}
        </button>
      </div>
    </form>
  );
}
