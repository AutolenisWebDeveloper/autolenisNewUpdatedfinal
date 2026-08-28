"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, CheckCircle2 } from "lucide-react";

interface InviteResult {
  id: string;
  inviteUrl: string;
  expiresAt: string;
}

export default function AdminDealerInvitePage() {
  const [form, setForm] = useState({
    dealershipName: "",
    contactName: "",
    email: "",
    personalMessage: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);

  function patch(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/dealers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { success?: boolean; data?: InviteResult; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to send invitation. Please try again.");
      } else if (data.data) {
        setResult(data.data);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="admin-invite-success-page">
        <div className="mb-6">
          <Link
            href="/admin/dealers/applications"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft size={14} />
            Back to applications
          </Link>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <CheckCircle2 size={40} className="text-green-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Invitation Sent</h2>
          <p className="text-sm text-slate-600 mb-6">
            An invitation email has been sent to <strong>{form.email}</strong>.
          </p>

          <div className="bg-white border border-slate-200 rounded-lg p-4 text-left" data-testid="admin-invite-result">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Invite Link</p>
            <p className="text-xs text-slate-700 break-all font-mono" data-testid="admin-invite-url">
              {result.inviteUrl}
            </p>
            <p className="text-xs text-slate-400 mt-3">
              Expires: {new Date(result.expiresAt).toLocaleString()}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setResult(null);
              setForm({ dealershipName: "", contactName: "", email: "", personalMessage: "" });
            }}
            className="mt-6 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            data-testid="admin-invite-send-another-btn"
          >
            Send another invitation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="admin-dealer-invite-page">
      <div className="mb-6">
        <Link
          href="/admin/dealers/applications"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          data-testid="admin-invite-back-link"
        >
          <ArrowLeft size={14} />
          Back to applications
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Send size={20} className="text-al-primary" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Send Direct Invitation</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Invite a dealer directly without requiring a prior application.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        data-testid="admin-invite-form"
        className="space-y-5 bg-white border border-slate-200 rounded-xl p-6"
      >
        <div>
          <label htmlFor="inv-dealership" className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
            Dealership Name <span className="text-red-500">*</span>
          </label>
          <input
            id="inv-dealership"
            data-testid="admin-invite-dealership-input"
            type="text"
            placeholder="ABC Motors LLC"
            required
            value={form.dealershipName}
            onChange={(e) => patch("dealershipName", e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
          />
        </div>

        <div>
          <label htmlFor="inv-contact" className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
            Contact Name <span className="text-red-500">*</span>
          </label>
          <input
            id="inv-contact"
            data-testid="admin-invite-contact-input"
            type="text"
            placeholder="Jane Smith"
            required
            value={form.contactName}
            onChange={(e) => patch("contactName", e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
          />
        </div>

        <div>
          <label htmlFor="inv-email" className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
            Email Address <span className="text-red-500">*</span>
          </label>
          <input
            id="inv-email"
            data-testid="admin-invite-email-input"
            type="email"
            placeholder="jane@abcmotors.com"
            required
            value={form.email}
            onChange={(e) => patch("email", e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
          />
        </div>

        <div>
          <label htmlFor="inv-message" className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
            Personal Message{" "}
            <span className="text-slate-400 font-normal normal-case">optional — max 500 chars</span>
          </label>
          <textarea
            id="inv-message"
            data-testid="admin-invite-message-input"
            placeholder="Include a personal note in the invitation email…"
            maxLength={500}
            rows={3}
            value={form.personalMessage}
            onChange={(e) => patch("personalMessage", e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors resize-none"
          />
          <p className="text-xs text-slate-400 mt-1 text-right">{form.personalMessage.length}/500</p>
        </div>

        {error && (
          <div
            className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md"
            data-testid="admin-invite-error"
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            data-testid="admin-invite-submit-btn"
            className="flex-1 py-2.5 bg-al-primary text-white font-semibold text-sm rounded-lg hover:bg-[#3a0063] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Send size={14} />
            {loading ? "Sending…" : "Send Invitation"}
          </button>
          <Link
            href="/admin/dealers"
            className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      <p className="text-xs text-slate-400 mt-4 text-center">
        {/* 7 days, per INVITATION_TOKEN_TTL_MS in account-claim.service.ts. Stated
            as a literal because that constant lives in a Prisma-importing service
            and this is a client component; the authoritative deadline the dealer
            sees is the formatted expiry in the invitation email itself. */}
        The invitation link expires in 7 days. You can resend it from the invitations list.
      </p>
    </div>
  );
}
