"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

interface Props {
  threadId: string;
}

// Feature 33 — Admin replies to a buyer message thread
export default function AdminMessageReply({ threadId }: Props) {
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
      await api.post(`/api/admin/messages/${threadId}`, { content: content.trim() });
      setContent("");
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to send reply. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-4"
      data-testid="admin-reply-form"
    >
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Reply as Admin
      </p>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Type your reply to the buyer…"
        rows={3}
        maxLength={4000}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
        data-testid="admin-reply-textarea"
      />
      {error && (
        <p className="text-xs text-red-600 mt-1" data-testid="admin-reply-error">
          {error}
        </p>
      )}
      <div className="flex justify-end mt-3">
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-al-primary text-white rounded-lg text-xs font-semibold hover:bg-al-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="admin-reply-submit-btn"
        >
          <Send size={12} />
          {submitting ? "Sending…" : "Send Reply"}
        </button>
      </div>
    </form>
  );
}
