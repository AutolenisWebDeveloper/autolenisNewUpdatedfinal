"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const INPUT_CLASS =
  "w-full border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30";

export default function NewMessagePage() {
  const router = useRouter();
  const [dealId, setDealId] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, content }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        setError(data.error?.message ?? "Something went wrong");
        return;
      }
      router.push("/dealer/messages");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="new-message-page">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dealer/messages"
          className="text-sm text-slate-400 hover:text-al-primary transition-colors"
        >
          ← Messages
        </Link>
        <h1 className="text-xl font-bold text-slate-900">New Message</h1>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 mb-6 text-sm">
        Messages can only be created within an existing deal context.
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-5 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Deal ID <span className="text-red-500">*</span>
          </label>
          <input
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            placeholder="Enter the deal ID"
            required
            className={INPUT_CLASS}
            data-testid="deal-id-input"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Message <span className="text-red-500">*</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your message..."
            required
            rows={4}
            className={INPUT_CLASS}
            data-testid="message-input"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          data-testid="send-message-btn"
        >
          {loading ? "Sending..." : "Send Message"}
        </button>
      </form>
    </div>
  );
}
