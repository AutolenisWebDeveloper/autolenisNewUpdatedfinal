"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import { Eye, EyeOff, KeyRound, ArrowLeft } from "lucide-react";

function getPasswordStrength(password: string): { label: string; color: string; width: string } {
  if (password.length === 0) return { label: "", color: "bg-slate-200", width: "0%" };

  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { label: "Weak",   color: "bg-red-500",    width: "33%" };
  if (score <= 4) return { label: "Fair",   color: "bg-yellow-400", width: "66%" };
  return              { label: "Strong", color: "bg-green-500",  width: "100%" };
}

export default function DealerResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Supabase appends ?token_hash=xxx&type=recovery to the redirectTo URL.
  const tokenHash = searchParams.get("token_hash") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [success, setSuccess] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!tokenHash) setExpired(true);
  }, [tokenHash]);

  const strength = getPasswordStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/dealer/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash, password }),
      });
      const data = await res.json() as { success?: boolean; error?: string; expired?: boolean };

      if (res.ok) {
        setSuccess(true);
        redirectTimerRef.current = setTimeout(() => router.push("/dealer/sign-in"), 2000);
      } else if (data.expired) {
        setExpired(true);
      } else {
        setError(data.error ?? "Failed to reset password. Please try again.");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col" data-testid="dealer-reset-password-page">
      {/* Branded top bar */}
      <div className="h-[64px] bg-gradient-to-r from-[#0B5FD1] to-[#0A4DB8] flex items-center px-8">
        <AutoLenisLogo size="sm" variant="light" href="/" testId="reset-password-logo" />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          {/* ── Expired / no token state ─────────────────────────────────── */}
          {expired && !success && (
            <div data-testid="reset-password-expired" className="text-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
                <KeyRound size={20} className="text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-[#111827] mb-3 tracking-tight">
                Reset link expired
              </h2>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                This password reset link is invalid or has expired. Request a new one below.
              </p>
              <Link
                href="/dealer/forgot-password"
                className="inline-block px-6 py-3 bg-[#0B5FD1] text-white text-sm font-bold rounded-md hover:bg-[#0A4DB8] transition-colors"
                data-testid="reset-password-re-request-link"
              >
                Request new reset link
              </Link>
              <div className="mt-4">
                <Link
                  href="/dealer/sign-in"
                  className="inline-flex items-center gap-1 text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors"
                  data-testid="reset-password-back-link"
                >
                  <ArrowLeft size={12} />
                  Back to sign in
                </Link>
              </div>
            </div>
          )}

          {/* ── Success state ────────────────────────────────────────────── */}
          {success && (
            <div data-testid="reset-password-success" className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                <KeyRound size={20} className="text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-[#111827] mb-3 tracking-tight">
                Password reset!
              </h2>
              <p className="text-sm text-slate-500">
                Redirecting you to sign in…
              </p>
            </div>
          )}

          {!expired && !success && (
            <>
              <div className="w-12 h-12 rounded-full bg-[#0B5FD1]/10 flex items-center justify-center mb-6">
                <KeyRound size={20} className="text-[#0B5FD1]" />
              </div>

              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-2">
                Dealer Portal
              </p>
              <h1 className="text-2xl font-bold text-[#111827] mb-2 tracking-tight">
                Choose a new password
              </h1>
              <p className="text-sm text-[#94A3B8] mb-8">
                Your new password must be at least 8 characters.
              </p>

              <form onSubmit={handleSubmit} data-testid="reset-password-form" className="space-y-5">
                <div>
                  <label
                    htmlFor="rp-password"
                    className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2"
                  >
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="rp-password"
                      data-testid="reset-password-input"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0B5FD1] transition-colors"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {/* Password strength indicator */}
                  {password.length > 0 && (
                    <div className="mt-2" data-testid="password-strength-indicator">
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                          style={{ width: strength.width }}
                        />
                      </div>
                      <p className={`text-xs mt-1 ${
                        strength.label === "Weak"   ? "text-red-500" :
                        strength.label === "Fair"   ? "text-yellow-600" :
                        "text-green-600"
                      }`} data-testid="password-strength-label">
                        {strength.label}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="rp-confirm"
                    className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="rp-confirm"
                    data-testid="reset-password-confirm-input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    autoComplete="new-password"
                    className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                  />
                </div>

                {error && (
                  <div
                    className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md"
                    data-testid="reset-password-error"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  data-testid="reset-password-submit"
                  className="w-full py-3.5 bg-[#0B5FD1] text-white font-bold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[#0B5FD1]/20"
                >
                  {loading ? "Resetting…" : "Reset Password"}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/dealer/sign-in"
                  className="inline-flex items-center gap-1 text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors"
                  data-testid="reset-password-signin-link"
                >
                  <ArrowLeft size={12} />
                  Back to sign in
                </Link>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
