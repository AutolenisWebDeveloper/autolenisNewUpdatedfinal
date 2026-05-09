"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.status === 429) {
        setError(data.error ?? "Please wait before requesting another email.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-center" data-testid="verify-email-page">
      <div className="w-14 h-14 rounded-full bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center mx-auto mb-4">
        <Mail size={24} className="text-[#0B5FD1]" />
      </div>
      <h1 className="text-2xl font-bold text-[#111827] mb-2 tracking-tight">Verify your email</h1>
      <p className="text-sm text-[#4B5563] mb-6 leading-relaxed">
        We sent a verification link to your email address.<br />
        Click the link to activate your account.
      </p>

      {sent ? (
        <div
          className="flex items-center justify-center gap-2 text-sm text-[#10B981] font-medium mb-4"
          data-testid="resend-success"
        >
          <CheckCircle2 size={16} />
          Verification email resent successfully.
        </div>
      ) : (
        <div className="mt-2 mb-6" data-testid="resend-form-section">
          <p className="text-xs text-[#6B7280] mb-3">Didn&apos;t receive it? Enter your email to resend.</p>
          <form onSubmit={handleResend} className="flex flex-col gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              data-testid="resend-email-input"
              className="w-full px-4 py-2.5 border border-[#D1D5DB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1] focus:border-transparent"
            />
            {error && (
              <p className="text-xs text-red-600 text-left" data-testid="resend-error">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              data-testid="resend-submit-btn"
              className="w-full py-2.5 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Sending…
                </span>
              ) : "Resend Verification Email"}
            </button>
          </form>
        </div>
      )}

      <p className="mt-4 text-xs text-[#9CA3AF]">
        Already verified?{" "}
        <Link
          href="/auth/signin"
          className="text-[#0B5FD1] hover:underline font-semibold"
          data-testid="goto-signin-link"
        >
          Sign in →
        </Link>
      </p>
    </div>
  );
}
