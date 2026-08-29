"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  DollarSign,
  Users,
  TrendingUp,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import { signInAction } from "@/lib/auth/actions";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";
import type { AuthPageStats } from "@/lib/services/auth/stats.service";

const L1_COMMISSION = `$${((PREMIUM_FEE_CENTS / 100) * COMMISSION_RATES.LEVEL_1).toFixed(0)}`;

const AFFILIATE_BULLETS = [
  { icon: DollarSign, text: `Earn ${L1_COMMISSION} per closed deal — paid directly to you` },
  { icon: Users,      text: "Multi-level referral network — earn from your team's sales" },
  { icon: TrendingUp, text: "A dashboard tracking every referral and commission" },
];

interface Props {
  stats: AuthPageStats;
}

export default function AffiliateSignInClient({ stats }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyRequired, setVerifyRequired] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  // O2 — resend the affiliate verification email through the shared route.
  async function handleResendVerification() {
    setResendState("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResendState(res.ok ? "sent" : "failed");
    } catch {
      setResendState("failed");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setVerifyRequired(false);
    setResendState("idle");
    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("password", password);
      const result = await signInAction(formData);
      if (result?.error) {
        // O2 — verify_required is a machine token, previously rendered
        // verbatim; map it to human copy with a resend action.
        if (result.error === "verify_required") {
          setVerifyRequired(true);
          setError("Please verify your email before signing in. Check your inbox for the verification link.");
        } else {
          setError(result.error);
        }
        return;
      }
      // signInAction redirects on success; if we reach here, force redirect
      router.push("/affiliate/portal/dashboard");
      router.refresh();
    } catch {
      setError("Sign in failed. Please check your email and password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-al-bg">

      {/* LEFT PANEL — value proposition */}
      <div className="hidden lg:flex lg:w-[45%] bg-al-primary flex-col justify-between p-10 xl:p-14">
        <AutoLenisLogo size="md" variant="light" href="/" />

        <div>
          <p className="text-blue-200 text-sm font-semibold uppercase tracking-widest mb-4">
            Affiliate Portal
          </p>
          <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight mb-6">
            Welcome back.<br />Your earnings are waiting.
          </h1>
          <div className="space-y-4">
            {AFFILIATE_BULLETS.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={18} className="text-white" />
                </div>
                <p className="text-blue-100 text-sm leading-relaxed pt-1.5">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Deals Closed",    value: stats.dealsCompleted > 0 ? stats.dealsCompleted.toLocaleString() : "—" },
            { label: "Buyers Served",   value: stats.buyersServed > 0   ? stats.buyersServed.toLocaleString()   : "—" },
            { label: "Avg Buyer Save",  value: stats.avgSavingsDollars > 0 ? `$${stats.avgSavingsDollars.toLocaleString()}` : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/10 rounded-xl p-3 text-center">
              <p className="text-white font-bold text-lg leading-none mb-1">{value}</p>
              <p className="text-blue-200 text-[10px] leading-tight">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL — sign in form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <AutoLenisLogo size="md" variant="dark" href="/" />
          </div>

          <h2 className="text-2xl font-bold text-al-text mb-1">Affiliate Sign In</h2>
          <p className="text-sm text-al-text-subtle mb-8">
            Access your referral dashboard and earnings.
          </p>

          {/* Error */}
          {error && (
            <div
              className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5"
              data-testid="affiliate-signin-error"
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="text-red-500 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
              {verifyRequired && (
                <div className="mt-2 pl-6 text-sm" data-testid="resend-verification">
                  {resendState === "sent" ? (
                    <p className="text-green-700">Verification email sent — check your inbox.</p>
                  ) : resendState === "failed" ? (
                    <p className="text-red-700">Couldn&apos;t resend right now. Try again in a minute.</p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resendState === "sending"}
                      className="text-al-primary font-semibold hover:underline disabled:opacity-60"
                    >
                      {resendState === "sending" ? "Sending…" : "Resend verification email"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" data-testid="affiliate-signin-form">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-al-text-muted mb-1.5" htmlFor="aff-email">
                Email Address
              </label>
              <input
                id="aff-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="affiliate-signin-email"
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 bg-al-bg border border-al-border rounded-md text-sm focus:outline-none focus:border-al-primary focus:ring-2 focus:ring-al-primary/30 transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-medium text-al-text-muted" htmlFor="aff-password">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-al-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="aff-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  data-testid="affiliate-signin-password"
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-al-bg border border-al-border rounded-md text-sm focus:outline-none focus:border-al-primary focus:ring-2 focus:ring-al-primary/30 transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-al-text-subtle hover:text-al-text-muted"
                  data-testid="affiliate-signin-show-password"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              data-testid="affiliate-signin-submit"
              className="w-full py-3 bg-al-primary text-white font-bold text-sm rounded-md hover:bg-al-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-al-primary/20 flex items-center justify-center gap-2 mt-2"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Signing in…</>
                : "Sign In to Affiliate Portal"}
            </button>
          </form>

          {/* Links */}
          <div className="mt-6 space-y-3 text-center">
            <p className="text-xs text-al-text-subtle">
              Not an affiliate yet?{" "}
              <Link
                href="/affiliate/register"
                className="text-al-primary font-semibold hover:underline"
                data-testid="affiliate-signin-register-link"
              >
                Apply to join →
              </Link>
            </p>
            <p className="text-xs text-al-text-subtle">
              Are you a buyer?{" "}
              <Link href="/auth/signin" className="text-al-primary hover:underline">
                Buyer sign in →
              </Link>
            </p>
            <p className="text-xs text-al-text-subtle">
              Are you a dealer?{" "}
              <Link href="/dealer/sign-in" className="text-al-primary hover:underline">
                Dealer sign in →
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
