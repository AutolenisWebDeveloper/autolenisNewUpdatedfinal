"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signUpAction } from "@/lib/auth/actions";
import { CheckCircle2, Sparkles, ShieldCheck, Gauge, FileCheck2, Eye, EyeOff } from "lucide-react";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const GOOGLE_OAUTH_ENABLED =
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";

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

function GoogleSignUpButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Return nothing when OAuth is not configured — no disabled button
  if (!GOOGLE_OAUTH_ENABLED) return null;

  async function handleGoogleSignUp() {
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
        setError("Google sign-up is unavailable right now. Please use email and password.");
        setLoading(false);
      }
    } catch {
      setError("Google sign-up failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      {error && (
        <p className="text-xs text-red-600 mb-2 text-center" data-testid="google-oauth-signup-error">{error}</p>
      )}
      <button
        type="button"
        onClick={handleGoogleSignUp}
        disabled={loading}
        data-testid="google-oauth-signup-btn"
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
        {loading ? "Redirecting…" : "Sign up with Google"}
      </button>
    </div>
  );
}

interface StatsProps {
  buyersServed: number;
  avgSavingsDollars: number;
  verifiedDealers: number;
}

const TRUST_POINTS = [
  { icon: ShieldCheck, text: "Soft-pull prequal only — no credit score impact" },
  { icon: Gauge, text: "Dealers compete in a 48-hour private auction for your business" },
  { icon: FileCheck2, text: "Contract Shield & e-sign protection on every deal" },
];

// ─── Password strength helper ───────────────────────────────────────────────
// Returns 0 = none, 1 = weak, 2 = fair, 3 = strong. Sign-up gate requires ≥ 2.
function scorePassword(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return 1;
  if (score <= 2) return 1;
  if (score === 3) return 2;
  return 3;
}
const STRENGTH_LABELS = ["", "Weak", "Fair", "Strong"] as const;
const STRENGTH_COLORS = ["", "#E63946", "#E0A100", "#1A6B18"] as const;

function SignUpInner({ stats }: { stats: StatsProps }) {
  const searchParams = useSearchParams();
  const initialPlan = (searchParams.get("plan") || "").toUpperCase() === "PREMIUM" ? "PREMIUM" : "STANDARD";
  const refCode = searchParams.get("ref") ?? "";
  const redirectParam = searchParams.get("redirect") ?? "";
  const [plan, setPlan] = useState<"STANDARD" | "PREMIUM">(initialPlan as "STANDARD" | "PREMIUM");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [referralInput, setReferralInput] = useState(refCode);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  const strength = scorePassword(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;
  const canSubmit = strength >= 2 && passwordsMatch && agreeTerms && agreePrivacy && !loading;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (strength < 2) {
      setError("Please choose a stronger password (at least 8 characters with mixed case or a number).");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.set("plan", plan);
    // Honor optional ?redirect= param so the verification flow can return there.
    if (redirectParam) formData.set("redirect", redirectParam);
    // Persist referral code — visible field first, URL param next, cookie fallback last.
    const cookieRef = typeof document !== "undefined"
      ? (document.cookie.match(/(?:^|;\s*)affiliate_ref=([^;]*)/) ?? [])[1] ?? ""
      : "";
    formData.set("referralCode", referralInput || refCode || cookieRef);
    const result = await signUpAction(formData);
    setLoading(false);
    if (result?.error) setError(result.error);
    else if (result?.success) setSuccess(true);
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD]" data-testid="signup-success">
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-10 max-w-md w-full text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-[#50D14E]/15 flex items-center justify-center mx-auto mb-6 border border-[#50D14E]/25">
            <CheckCircle2 size={26} className="text-[#1A6B18]" />
          </div>
          <h2 className="text-2xl font-semibold text-[#111827] mb-3 tracking-tight">Check your email</h2>
          <p className="text-[#4B5563] text-sm leading-relaxed">
            We sent a confirmation link to your email address. Click it to activate your{" "}
            {plan === "PREMIUM" ? "Premium" : "Standard"} account.
          </p>
          <Link href="/auth/signin" className="mt-8 inline-block text-sm text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors font-semibold" data-testid="success-signin-link">← Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white" data-testid="signup-page">
      {/* Left panel — branded hero (desktop only) */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-col justify-between p-14 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B5FD1] via-[#0A4DB8] to-[#2667BF]" />
        <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,_#ffffff10_0px,_#ffffff10_1px,_transparent_1px,_transparent_40px)]" />

        <div className="relative">
          <AutoLenisLogo size="md" variant="light" href="/" testId="signup-brand-logo" />
        </div>

        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#50D14E] mb-4">Buyer Portal</p>
          <h1 className="text-4xl font-semibold text-white mb-4 leading-tight tracking-tight">
            Find your next car.<br />Without the negotiation.
          </h1>
          <p className="text-white/80 text-sm leading-relaxed mb-10 max-w-md">
            Tell us what you want. Verified dealers compete for your business in a private 48-hour auction. You pick the winner — or walk away with a full refund.
          </p>

          <ul className="space-y-4 mb-10">
            {TRUST_POINTS.map((b) => (
              <li key={b.text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0 border border-white/25">
                  <b.icon size={14} className="text-white" />
                </div>
                <span className="text-sm text-white/85">{b.text}</span>
              </li>
            ))}
          </ul>

          {/* Testimonial-style social proof strip */}
          <div className="bg-white/10 backdrop-blur border border-white/15 rounded-xl p-5" data-testid="signup-stat-strip">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-bold text-white font-[family-name:var(--font-mono)] tracking-tight">${stats.avgSavingsDollars.toLocaleString()}</p>
                <p className="text-[11px] text-white/65 mt-0.5">avg savings</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white font-[family-name:var(--font-mono)] tracking-tight">{stats.verifiedDealers}+</p>
                <p className="text-[11px] text-white/65 mt-0.5">dealers</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white font-[family-name:var(--font-mono)] tracking-tight">{stats.buyersServed.toLocaleString()}+</p>
                <p className="text-[11px] text-white/65 mt-0.5">buyers</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <p className="text-xs text-white/70">
            Already have an account?{" "}
            <Link href="/auth/signin" className="text-white hover:text-[#50D14E] transition-colors underline" data-testid="signup-signin-link">Sign in →</Link>
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile-only branded top bar */}
        <div className="lg:hidden h-[72px] bg-gradient-to-r from-[#0B5FD1] to-[#0A4DB8] flex items-center px-6">
          <AutoLenisLogo size="sm" variant="light" href="/" testId="signup-mobile-logo" />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 lg:px-12 py-10">
          <div className="w-full max-w-sm my-auto">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-4">Buyer Portal</p>
            <h2 className="text-2xl font-bold text-[#111827] mb-1 tracking-tight">Create your account</h2>
            <p className="text-sm text-[#94A3B8] mb-6">Start buying your next car the right way.</p>

            {/* Feature 8 — Social Sign-Up (only rendered when OAuth is configured) */}
            {GOOGLE_OAUTH_ENABLED && (
              <div className="mb-6" data-testid="social-signup-section">
                <GoogleSignUpButton />
                <div className="flex items-center gap-3 mt-4">
                  <div className="flex-1 h-px bg-[#E5E7EB]" />
                  <span className="text-xs text-[#94A3B8]">or sign up with email</span>
                  <div className="flex-1 h-px bg-[#E5E7EB]" />
                </div>
              </div>
            )}

            {/* Plan selector */}
            <div className="mb-6" data-testid="signup-plan-selector">
              <p className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-2.5">Choose your plan</p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setPlan("STANDARD")}
                  aria-pressed={plan === "STANDARD"}
                  data-testid="signup-plan-standard"
                  className={`text-left rounded-xl p-3.5 border-2 transition-all ${
                    plan === "STANDARD" ? "border-[#0B5FD1] bg-[#F8F9FB]" : "border-[#E5E7EB] bg-white hover:border-[#93C5FD]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#111827]">Standard</span>
                    {plan === "STANDARD" && <CheckCircle2 size={13} className="text-[#0B5FD1]" />}
                  </div>
                  <p className="text-sm font-bold text-[#0B5FD1] mt-1 font-[family-name:var(--font-mono)]">Free</p>
                  <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-tight">$99 deposit credited to purchase</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPlan("PREMIUM")}
                  aria-pressed={plan === "PREMIUM"}
                  data-testid="signup-plan-premium"
                  className={`relative text-left rounded-xl p-3.5 border-2 transition-all ${
                    plan === "PREMIUM" ? "border-[#0B5FD1] bg-[#F8F9FB]" : "border-[#E5E7EB] bg-white hover:border-[#93C5FD]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#111827]">
                      <Sparkles size={11} className="text-[#0B5FD1]" /> Premium
                    </span>
                    {plan === "PREMIUM" && <CheckCircle2 size={13} className="text-[#0B5FD1]" />}
                  </div>
                  <p className="text-sm font-bold text-[#0B5FD1] mt-1 font-[family-name:var(--font-mono)]">$499</p>
                  <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-tight">$400 after deposit credit</p>
                </button>
              </div>
              <p className="text-[11px] text-[#94A3B8] mt-2 leading-relaxed">
                {plan === "PREMIUM"
                  ? "Full white-glove concierge: dedicated specialist, financing guidance, free home delivery, priority support."
                  : "Private auction, Best Price Engine, Contract Shield, e-signing, QR pickup. No concierge fee."}
              </p>
            </div>

            <form onSubmit={handleSubmit} data-testid="signup-form" className="space-y-4">
              <input type="hidden" name="plan" value={plan} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="signup-firstName" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">First name</label>
                  <input id="signup-firstName" name="firstName" data-testid="signup-firstname-input" required
                    className="w-full px-3.5 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors" />
                </div>
                <div>
                  <label htmlFor="signup-lastName" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Last name</label>
                  <input id="signup-lastName" name="lastName" data-testid="signup-lastname-input" required
                    className="w-full px-3.5 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors" />
                </div>
              </div>
              <div>
                <label htmlFor="signup-email" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Email</label>
                <input id="signup-email" name="email" type="email" data-testid="signup-email-input" autoComplete="email" required
                  className="w-full px-3.5 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                  placeholder="you@example.com" />
              </div>
              <div>
                <label htmlFor="signup-password" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Password</label>
                <div className="relative">
                  <input id="signup-password" name="password" type={showPassword ? "text" : "password"} data-testid="signup-password-input" autoComplete="new-password" required minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-3.5 pr-11 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                    placeholder="At least 8 characters" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    data-testid="signup-password-toggle"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0B5FD1] transition-colors">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {/* Strength indicator (weak / fair / strong) */}
                {password.length > 0 && (
                  <div className="mt-2" data-testid="signup-password-strength">
                    <div className="flex gap-1">
                      {[1, 2, 3].map((step) => (
                        <div
                          key={step}
                          className="h-1 flex-1 rounded-full transition-colors"
                          style={{ background: strength >= step ? STRENGTH_COLORS[strength] : "#E5E7EB" }}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] mt-1.5" style={{ color: STRENGTH_COLORS[strength] || "#94A3B8" }} data-testid="signup-password-strength-label">
                      {STRENGTH_LABELS[strength]}{strength < 2 ? " — add more characters or mix letters/numbers" : ""}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="signup-confirm" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Confirm password</label>
                <div className="relative">
                  <input id="signup-confirm" name="confirmPassword" type={showConfirm ? "text" : "password"} data-testid="signup-confirm-input" autoComplete="new-password" required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-3.5 pr-11 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                    placeholder="Re-enter your password" />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    aria-pressed={showConfirm}
                    data-testid="signup-confirm-toggle"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0B5FD1] transition-colors">
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {showMismatch && (
                  <p className="text-[11px] text-red-600 mt-1.5" data-testid="signup-mismatch-hint">Passwords do not match.</p>
                )}
              </div>

              <div>
                <label htmlFor="signup-referral" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">
                  Referral code <span className="text-[#94A3B8] font-normal normal-case">(optional)</span>
                </label>
                <input id="signup-referral" name="referralCodeVisible" data-testid="signup-referral-input"
                  value={referralInput}
                  onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                  className="w-full px-3.5 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] uppercase focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
                  placeholder="ALXXXXXX" />
              </div>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-md" data-testid="signup-error">{error}</div>
              )}

              <div className="space-y-2.5 pt-1">
                <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="signup-terms-label">
                  <input
                    type="checkbox"
                    name="agreeTerms"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    required
                    data-testid="signup-terms-checkbox"
                    className="h-4 w-4 mt-0.5 rounded border-[#D8C7EE] text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                  />
                  <span className="text-xs text-[#4B5563] leading-relaxed">
                    I agree to the{" "}
                    <Link href="/legal/terms" target="_blank" className="text-[#0B5FD1] hover:underline">Terms of Service</Link>.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="signup-privacy-label">
                  <input
                    type="checkbox"
                    name="agreePrivacy"
                    checked={agreePrivacy}
                    onChange={(e) => setAgreePrivacy(e.target.checked)}
                    required
                    data-testid="signup-privacy-checkbox"
                    className="h-4 w-4 mt-0.5 rounded border-[#D8C7EE] text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                  />
                  <span className="text-xs text-[#4B5563] leading-relaxed">
                    I agree to the{" "}
                    <Link href="/legal/privacy" target="_blank" className="text-[#0B5FD1] hover:underline">Privacy Policy</Link>.
                  </span>
                </label>
              </div>

              <button type="submit" disabled={!canSubmit} data-testid="signup-submit-btn"
                className="w-full py-3.5 bg-[#0B5FD1] text-white font-bold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[#0B5FD1]/20 mt-2">
                {loading ? "Creating account…" : plan === "PREMIUM" ? "Create Premium Account" : "Create Account"}
              </button>
            </form>

            <p className="text-center text-sm text-[#4B5563] mt-6">
              Already have an account?{" "}
              <Link href="/auth/signin" className="text-[#0B5FD1] font-semibold hover:underline" data-testid="goto-signin-link">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage({ stats }: { stats: StatsProps }) {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-[#4B5563]">Loading…</div>}>
      <SignUpInner stats={stats} />
    </Suspense>
  );
}
