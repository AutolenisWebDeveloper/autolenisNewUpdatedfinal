"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ShieldCheck, Gauge, Handshake, CheckCircle2, Eye, EyeOff, AlertCircle, Mail } from "lucide-react";
import { signInAction } from "@/lib/auth/actions";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

interface StatsProps {
  buyersServed: number;
  avgSavingsDollars: number;
  dealsCompleted: number;
}

const TRUST_POINTS = [
  { icon: ShieldCheck, text: "Contract Shield on every closed deal" },
  { icon: Gauge, text: "Best Price Engine ranks your dealer offers" },
  { icon: Handshake, text: "Concierge support from auction to pickup" },
];

// ─── Google OAuth sign-in button ─────────────────────────────────────────────
// Only rendered when NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true".
// When OAuth is not configured this component returns null — no button,
// no disabled state, no tooltip theatre.

const GOOGLE_OAUTH_ENABLED =
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";

function GoogleSignInButton({ mode }: { mode: "signin" | "signup" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = mode === "signup" ? "Sign up with Google" : "Continue with Google";

  // Return nothing when OAuth is not configured — no disabled button
  if (!GOOGLE_OAUTH_ENABLED) return null;

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const callbackUrl = `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl },
      });
      if (oauthError) {
        setError("Google sign-in is unavailable right now. Please use email and password.");
        setLoading(false);
      }
      // On success Supabase redirects the browser — no further action needed.
    } catch {
      setError("Google sign-in failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      {error && (
        <p className="text-xs text-red-600 mb-2 text-center" data-testid="google-oauth-error">{error}</p>
      )}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        data-testid="google-oauth-btn"
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-white border border-[#E5E7EB] rounded-md text-sm font-medium text-[#111827] hover:bg-[#F8F9FB] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4 text-[#0B5FD1]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <GoogleIcon />
        )}
        {loading ? "Redirecting…" : label}
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function SignInInner({ stats }: { stats: StatsProps }) {
  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";
  const callbackError = searchParams.get("error");
  const redirectParam = searchParams.get("redirect") ?? "";
  const verifyRequired = callbackError === "verify_required";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    // "Remember me" — set client-readable hint cookie consumed by signInAction
    // to extend the session lifetime to 30 days vs the 7-day default.
    if (typeof document !== "undefined") {
      const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;
      document.cookie = `al_remember=${remember ? "1" : "0"}; path=/; max-age=${maxAge}; samesite=lax${
        location.protocol === "https:" ? "; secure" : ""
      }`;
    }
    formData.set("remember", remember ? "1" : "0");
    if (redirectParam) formData.set("redirect", redirectParam);
    const result = await signInAction(formData);
    setLoading(false);
    if (result?.error === "verify_required") {
      window.location.href = "/auth/signin?error=verify_required";
      return;
    }
    if (result?.error) setError(result.error);
  }

  return (
    <div className="min-h-screen flex bg-white" data-testid="signin-page">
      {/* Left panel — branded hero (desktop only) */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-col justify-between p-14 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B5FD1] via-[#0A4DB8] to-[#2667BF]" />
        <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,_#ffffff10_0px,_#ffffff10_1px,_transparent_1px,_transparent_40px)]" />

        <div className="relative">
          <AutoLenisLogo size="md" variant="light" href="/" testId="signin-brand-logo" />
        </div>

        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#50D14E] mb-4">Buyer Portal</p>
          <h1 className="text-4xl font-semibold text-white mb-4 leading-tight tracking-tight">
            Welcome back.
          </h1>
          <p className="text-white/80 text-sm leading-relaxed mb-10 max-w-md">
            Your vehicle search and deal progress are waiting. Sign in to continue where you left off.
          </p>

          {/* Live stat */}
          <div className="bg-white/10 backdrop-blur border border-white/15 rounded-xl p-5 mb-10" data-testid="signin-live-stat">
            <p className="text-xs text-white/65 uppercase tracking-wider mb-1">This quarter</p>
            <p className="text-2xl font-bold text-white font-[family-name:var(--font-mono)] tracking-tight">
              {stats.buyersServed.toLocaleString()}+ buyers
            </p>
            <p className="text-sm text-white/70 mt-1">
              found their car through AutoLenis — average savings <span className="text-[#50D14E] font-semibold">${stats.avgSavingsDollars.toLocaleString()}</span>.
            </p>
          </div>

          <ul className="space-y-4">
            {TRUST_POINTS.map((b) => (
              <li key={b.text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0 border border-white/25">
                  <b.icon size={14} className="text-white" />
                </div>
                <span className="text-sm text-white/85">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <p className="text-xs text-white/70">
            Are you a dealer?{" "}
            <Link href="/dealer/signin" className="text-white hover:text-[#50D14E] transition-colors underline" data-testid="signin-dealer-portal-link">
              Dealer Portal →
            </Link>
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile-only branded top bar (72px) */}
        <div className="lg:hidden h-[72px] bg-gradient-to-r from-[#0B5FD1] to-[#0A4DB8] flex items-center px-6">
          <AutoLenisLogo size="sm" variant="light" href="/" testId="signin-mobile-logo" />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 lg:px-12 py-10 lg:py-0">
          <div className="w-full max-w-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-4">Buyer Portal</p>
            <h2 className="text-2xl font-bold text-[#111827] mb-1 tracking-tight">Sign in to your account</h2>
            <p className="text-sm text-[#94A3B8] mb-8">Resume your vehicle search and deal progress.</p>

            {resetSuccess && (
              <div
                className="mb-5 flex items-start gap-2.5 rounded-md border border-[#50D14E]/30 bg-[#50D14E]/10 px-3 py-2.5"
                data-testid="signin-reset-success-banner"
                role="status"
              >
                <CheckCircle2 size={16} className="text-[#1A6B18] shrink-0 mt-0.5" />
                <p className="text-xs text-[#1A6B18] leading-relaxed">
                  Password updated successfully. Sign in with your new password.
                </p>
              </div>
            )}

            {callbackError === "callback_failed" && (
              <div
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5"
                data-testid="signin-callback-error-banner"
                role="alert"
              >
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 leading-relaxed">
                  Your verification link is invalid or has expired.{" "}
                  <Link href="/auth/verify-email" className="font-semibold underline">
                    Request a new one →
                  </Link>
                </p>
              </div>
            )}

            {verifyRequired && (
              <div
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
                data-testid="signin-verify-required-banner"
                role="status"
              >
                <Mail size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Please verify your email before signing in.{" "}
                  <Link href="/auth/verify-email" className="font-semibold underline">
                    Resend verification →
                  </Link>
                </p>
              </div>
            )}

            {/* Feature 8 — Social Sign-In (only rendered when OAuth is configured) */}
            {GOOGLE_OAUTH_ENABLED && (
              <div className="mb-6" data-testid="social-signin-section">
                <GoogleSignInButton mode="signin" />
                <div className="flex items-center gap-3 mt-4">
                  <div className="flex-1 h-px bg-[#E5E7EB]" />
                  <span className="text-xs text-[#94A3B8]">or continue with email</span>
                  <div className="flex-1 h-px bg-[#E5E7EB]" />
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} data-testid="signin-form" className="space-y-5">
              <div>
                <label htmlFor="signin-email" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Email</label>
                <input id="signin-email" name="email" type="email" data-testid="signin-email-input" autoComplete="email" required
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                  placeholder="you@example.com" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="signin-password" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider">Password</label>
                  <Link href="/auth/forgot-password" className="text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors" data-testid="forgot-password-link">Forgot?</Link>
                </div>
                <div className="relative">
                  <input id="signin-password" name="password" type={showPassword ? "text" : "password"} data-testid="signin-password-input" autoComplete="current-password" required
                    className="w-full pl-4 pr-11 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                    placeholder="••••••••" />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    data-testid="signin-password-toggle"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0B5FD1] transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 select-none cursor-pointer" data-testid="signin-remember-label">
                <input
                  type="checkbox"
                  name="remember"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  data-testid="signin-remember-checkbox"
                  className="h-4 w-4 rounded border-[#D8C7EE] text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                />
                <span className="text-xs text-[#4B5563]">Remember me for 30 days</span>
              </label>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md" data-testid="signin-error">{error}</div>
              )}

              <button type="submit" disabled={loading} data-testid="signin-submit-btn"
                className="w-full py-3.5 bg-[#0B5FD1] text-white font-bold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[#0B5FD1]/20">
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <p className="text-center text-sm text-[#4B5563] mt-6">
              New to AutoLenis?{" "}
              <Link href="/auth/signup" className="text-[#0B5FD1] font-semibold hover:underline" data-testid="goto-signup-link">Create account</Link>
            </p>

            <div className="mt-8 pt-6 border-t border-[#E5E7EB] grid grid-cols-2 gap-3 text-center">
              <Link href="/dealer/signin" className="text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors" data-testid="goto-dealer-signin-link">
                Dealer Portal →
              </Link>
              <Link href="/affiliate/register" className="text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors" data-testid="goto-affiliate-register-link">
                Affiliate Program →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage({ stats }: { stats: StatsProps }) {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-[#4B5563]">Loading…</div>}>
      <SignInInner stats={stats} />
    </Suspense>
  );
}
