"use client";

import { useState } from "react";
import Link from "next/link";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import { Mail, ArrowLeft } from "lucide-react";

export default function DealerForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/dealer/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok && res.status !== 200) {
        // Still show success to prevent email enumeration
      }
      setSubmitted(true);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col" data-testid="dealer-forgot-password-page">
      {/* Branded top bar */}
      <div className="h-[64px] bg-gradient-to-r from-[#0B5FD1] to-[#0A4DB8] flex items-center px-8">
        <AutoLenisLogo size="sm" variant="light" href="/" testId="forgot-password-logo" />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {!submitted ? (
            <>
              <div className="w-12 h-12 rounded-full bg-[#0B5FD1]/10 flex items-center justify-center mb-6">
                <Mail size={20} className="text-[#0B5FD1]" />
              </div>

              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-2">
                Dealer Portal
              </p>
              <h1 className="text-2xl font-bold text-[#111827] mb-2 tracking-tight">
                Reset your password
              </h1>
              <p className="text-sm text-[#94A3B8] mb-8">
                Enter your business email and we&apos;ll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} data-testid="forgot-password-form" className="space-y-5">
                <div>
                  <label
                    htmlFor="fp-email"
                    className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2"
                  >
                    Business Email
                  </label>
                  <input
                    id="fp-email"
                    data-testid="forgot-password-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dealer@example.com"
                    required
                    autoComplete="email"
                    className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                  />
                </div>

                {error && (
                  <div
                    className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md"
                    data-testid="forgot-password-error"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  data-testid="forgot-password-submit"
                  className="w-full py-3.5 bg-[#0B5FD1] text-white font-bold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[#0B5FD1]/20"
                >
                  {loading ? "Sending…" : "Send Reset Link"}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/dealer/sign-in"
                  className="inline-flex items-center gap-1 text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors"
                  data-testid="forgot-password-back-link"
                >
                  <ArrowLeft size={12} />
                  Back to sign in
                </Link>
              </div>
            </>
          ) : (
            <div data-testid="forgot-password-success" className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                <Mail size={20} className="text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-[#111827] mb-3 tracking-tight">Check your inbox</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-8" data-testid="forgot-password-success-message">
                If an account exists for this email, you will receive a password reset link shortly.
              </p>
              <Link
                href="/dealer/sign-in"
                className="inline-flex items-center gap-1 text-sm text-[#0B5FD1] hover:underline"
                data-testid="forgot-password-return-link"
              >
                <ArrowLeft size={14} />
                Return to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
