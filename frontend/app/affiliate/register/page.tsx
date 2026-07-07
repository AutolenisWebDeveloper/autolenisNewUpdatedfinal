"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, DollarSign, TrendingUp, Users, Mail } from "lucide-react";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";
import { createBrowserClient } from "@supabase/ssr";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";

const L1 = ((PREMIUM_FEE_CENTS / 100) * COMMISSION_RATES.LEVEL_1).toFixed(2);
const L2 = ((PREMIUM_FEE_CENTS / 100) * COMMISSION_RATES.LEVEL_2).toFixed(2);
const L3 = ((PREMIUM_FEE_CENTS / 100) * COMMISSION_RATES.LEVEL_3).toFixed(2);

const PROMOTION_METHODS = [
  "Personal Blog / Website",
  "YouTube Channel",
  "Social Media (Instagram / TikTok / Facebook)",
  "Email Newsletter",
  "Podcast",
  "Community / Forum",
  "Paid Advertising",
  "Other",
];

function PasswordStrength({ password }: { password: string }) {
  const score = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);

  if (!password) return null;

  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-[#50D14E]"];
  const textColors = ["text-red-500", "text-orange-500", "text-yellow-600", "text-blue-500", "text-[#1A6B18]"];

  return (
    <div className="mt-2" data-testid="password-strength-indicator">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= score ? colors[score - 1] : "bg-[#E5E7EB]"}`}
          />
        ))}
      </div>
      <p className={`text-[10px] font-medium ${textColors[score - 1] ?? "text-[#94A3B8]"}`}>
        {labels[score - 1] ?? "Enter a password"}
      </p>
    </div>
  );
}

export default function AffiliateRegisterPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [emailExists, setEmailExists] = useState(false);

  // Silently redirect already-authenticated affiliates to their portal
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        const role = data.session.user.user_metadata?.role as string | undefined;
        if (role === "AFFILIATE") router.replace("/affiliate/portal/dashboard");
      }
    }).catch(() => { /* silent */ });
  }, [router]);

  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", password: "", confirmPassword: "",
    website: "", promotionMethod: "", ftcDisclosure: false, termsAgreed: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const errs: Record<string, string> = {};
    if (!form.firstName.trim()) errs.firstName = "Required";
    if (!form.lastName.trim()) errs.lastName = "Required";
    if (!form.email.includes("@")) errs.email = "Valid email required";
    if (form.password.length < 8) errs.password = "Minimum 8 characters";
    if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
    if (!form.promotionMethod) errs.promotionMethod = "Please select a method";
    if (!form.ftcDisclosure) errs.ftcDisclosure = "FTC disclosure acknowledgment required";
    if (!form.termsAgreed) errs.termsAgreed = "You must agree to the Affiliate Terms";
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    setEmailExists(false);
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/affiliate/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.toLowerCase().trim(),
          password: form.password,
          website: form.website.trim() || undefined,
          promotionMethod: form.promotionMethod,
          ftcDisclosure: form.ftcDisclosure,
          termsAgreed: form.termsAgreed,
        }),
      });
      const data = await res.json() as {
        success?: boolean;
        data?: { email?: string; referralCode?: string };
        error?: { code?: string; message?: string };
      };

      if (res.status === 409 || data.error?.code === "EMAIL_EXISTS") {
        setEmailExists(true);
        return;
      }
      if (!res.ok || !data.success) {
        setServerError(data.error?.message ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmittedEmail(data.data?.email ?? form.email.toLowerCase().trim());
      setSubmitted(true);
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD]" data-testid="affiliate-register-success">
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-10 max-w-md w-full text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-[#50D14E]/15 flex items-center justify-center mx-auto mb-6 border border-[#50D14E]/25">
            <Mail size={26} className="text-[#1A6B18]" />
          </div>
          <h2 className="text-2xl font-semibold text-[#111827] mb-3 tracking-tight">Check your email</h2>
          <p className="text-[#4B5563] text-sm leading-relaxed mb-2">We sent a verification link to</p>
          <p className="text-[#111827] font-semibold text-sm mb-5" data-testid="affiliate-submitted-email">{submittedEmail}</p>
          <p className="text-[#4B5563] text-sm leading-relaxed">Click the link to verify your account. Once our team reviews your application (typically within 2 business days) we'll activate your referral code and email you a link to your affiliate dashboard.</p>
          <Link href="/affiliate/signin" className="mt-8 inline-block text-sm text-al-primary hover:text-al-primary-hover transition-colors font-semibold" data-testid="success-signin-link">← Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white" data-testid="affiliate-register-page">
      {/* Left panel — Commission tree visual on branded purple hero */}
      <div className="hidden lg:flex lg:w-[48%] relative flex-col justify-between p-14 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-al-primary via-al-primary-hover to-[#2667BF]" />
        <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,_#ffffff10_0px,_#ffffff10_1px,_transparent_1px,_transparent_40px)]" />

        <div className="relative">
          <AutoLenisLogo size="md" variant="light" href="/" testId="affiliate-brand-logo" />
        </div>

        <div className="relative">
          <h1 className="text-3xl font-semibold text-white mb-3 leading-tight tracking-tight">
            Earn while helping people buy cars the right way.
          </h1>
          <p className="text-white/75 text-sm mb-12 leading-relaxed">3-level commission tree. Automatic payouts. Real-time dashboard.</p>

          <div className="space-y-3" data-testid="commission-tree-visual">
            {[
              { level: "L1 — Direct Referral", pct: `${Math.round(COMMISSION_RATES.LEVEL_1 * 100)}%`, amount: `$${L1}`, color: "bg-[#50D14E]/15 border-[#50D14E]/40", textColor: "text-[#D5FBD4]", indent: "" },
              { level: "L2 — Network", pct: `${Math.round(COMMISSION_RATES.LEVEL_2 * 100)}%`, amount: `$${L2}`, color: "bg-white/10 border-white/20", textColor: "text-white/80", indent: "ml-5" },
              { level: "L3 — Extended", pct: `${Math.round(COMMISSION_RATES.LEVEL_3 * 100)}%`, amount: `$${L3}`, color: "bg-white/5 border-white/15", textColor: "text-white/65", indent: "ml-10" },
            ].map((tier) => (
              <div key={tier.level} className={`flex items-center justify-between border rounded-lg px-4 py-3 ${tier.color} ${tier.indent}`}>
                <div>
                  <p className={`text-xs font-semibold ${tier.textColor}`}>{tier.level}</p>
                  <p className="text-[10px] text-white/55">per completed deal</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold font-[family-name:var(--font-mono)] text-white">{tier.pct}</p>
                  <p className={`text-xs ${tier.textColor} font-[family-name:var(--font-mono)]`}>{tier.amount}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-5 mt-10">
            {[
              { icon: DollarSign, text: "Free to join" },
              { icon: Users, text: "3-level depth" },
              { icon: TrendingUp, text: "Auto payouts" },
            ].map((item) => (
              <div key={item.text} className="flex flex-col items-center gap-1.5">
                <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center border border-white/25">
                  <item.icon size={15} className="text-white" />
                </div>
                <span className="text-[10px] text-white/75">{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <p className="text-[10px] text-white/55 leading-relaxed">
            Commission rates based on $499 Premium concierge fee. Subject to Affiliate Terms. Max 20% total per deal.
          </p>
        </div>
      </div>

      {/* Right panel — light registration form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-white border-l border-[#E5E7EB] overflow-y-auto">
        <div className="w-full max-w-sm my-auto">
          <div className="lg:hidden mb-8">
            <AutoLenisLogo size="sm" variant="dark" href="/" />
          </div>

          <h2 className="text-2xl font-bold text-[#111827] mb-1 tracking-tight">Join as an affiliate</h2>
          <p className="text-sm text-[#94A3B8] mb-8">Free to join. Commissions paid on deal completion.</p>

          {emailExists && (
            <div className="mb-5 p-3 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-900" data-testid="affiliate-email-exists-error">
              An account with this email already exists.{" "}
              <Link href="/affiliate/signin" className="font-semibold text-al-primary hover:underline" data-testid="existing-account-signin-link">Sign in instead →</Link>
            </div>
          )}
          {serverError && (
            <div className="mb-5 p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-700" data-testid="affiliate-server-error">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} data-testid="affiliate-register-form" className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">First name</label>
                <input type="text" data-testid="reg-first-input" required
                  className={`w-full px-3.5 py-2.5 bg-[#F8F9FB] border rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors ${errors.firstName ? "border-red-400" : "border-[#E5E7EB]"}`}
                  value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                {errors.firstName && <p className="text-[10px] text-red-500 mt-1">{errors.firstName}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Last name</label>
                <input type="text" data-testid="reg-last-input" required
                  className={`w-full px-3.5 py-2.5 bg-[#F8F9FB] border rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors ${errors.lastName ? "border-red-400" : "border-[#E5E7EB]"}`}
                  value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                {errors.lastName && <p className="text-[10px] text-red-500 mt-1">{errors.lastName}</p>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Email</label>
              <input type="email" data-testid="reg-email-input" required autoComplete="email"
                className={`w-full px-3.5 py-2.5 bg-[#F8F9FB] border rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors ${errors.email ? "border-red-400" : "border-[#E5E7EB]"}`}
                placeholder="you@example.com" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setEmailExists(false); }} />
              {errors.email && <p className="text-[10px] text-red-500 mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Password</label>
              <input type="password" data-testid="reg-password-input" required autoComplete="new-password"
                className={`w-full px-3.5 py-2.5 bg-[#F8F9FB] border rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors ${errors.password ? "border-red-400" : "border-[#E5E7EB]"}`}
                placeholder="Min. 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <PasswordStrength password={form.password} />
              {errors.password && <p className="text-[10px] text-red-500 mt-1">{errors.password}</p>}
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Confirm password</label>
              <input type="password" data-testid="reg-confirm-password-input" required autoComplete="new-password"
                className={`w-full px-3.5 py-2.5 bg-[#F8F9FB] border rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors ${errors.confirmPassword ? "border-red-400" : "border-[#E5E7EB]"}`}
                placeholder="Re-enter password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
              {errors.confirmPassword && <p className="text-[10px] text-red-500 mt-1">{errors.confirmPassword}</p>}
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Website or social <span className="text-[#94A3B8] normal-case font-normal">(optional)</span></label>
              <input type="url" data-testid="reg-website-input"
                className="w-full px-3.5 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] text-sm placeholder-[#94A3B8] focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                placeholder="https://yourblog.com" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2">Primary promotion method</label>
              <select data-testid="reg-promotion-method-select" required
                className={`w-full px-3.5 py-2.5 bg-[#F8F9FB] border rounded-md text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors ${errors.promotionMethod ? "border-red-400 text-[#94A3B8]" : "border-[#E5E7EB] text-[#4B5563]"}`}
                value={form.promotionMethod} onChange={(e) => setForm({ ...form, promotionMethod: e.target.value })}>
                <option value="">Select a method…</option>
                {PROMOTION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {errors.promotionMethod && <p className="text-[10px] text-red-500 mt-1">{errors.promotionMethod}</p>}
            </div>
            <div>
              <label className="flex items-start gap-3 cursor-pointer" data-testid="ftc-disclosure-label">
                <input type="checkbox" data-testid="ftc-disclosure-checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-[#DBEAFE] accent-al-primary shrink-0"
                  checked={form.ftcDisclosure} onChange={(e) => setForm({ ...form, ftcDisclosure: e.target.checked })} />
                <span className="text-xs text-[#4B5563] leading-relaxed">I understand FTC requirements to clearly disclose my affiliate relationship in all promotional content. I will not misrepresent the product.</span>
              </label>
              {errors.ftcDisclosure && <p className="text-[10px] text-red-500 mt-1">{errors.ftcDisclosure}</p>}
            </div>
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" data-testid="terms-agreed-checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-[#DBEAFE] accent-al-primary shrink-0"
                  checked={form.termsAgreed} onChange={(e) => setForm({ ...form, termsAgreed: e.target.checked })} />
                <span className="text-xs text-[#4B5563] leading-relaxed">
                  I agree to the <Link href="/legal/affiliate-terms" className="text-al-primary hover:text-al-primary-hover underline">Affiliate Terms</Link> and <Link href="/legal/privacy" className="text-al-primary hover:text-al-primary-hover underline">Privacy Policy</Link>.
                </span>
              </label>
              {errors.termsAgreed && <p className="text-[10px] text-red-500 mt-1">{errors.termsAgreed}</p>}
            </div>
            <button type="submit" className="w-full py-3.5 bg-al-primary text-white font-bold text-sm rounded-md hover:bg-al-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-al-primary/20 mt-2" disabled={loading} data-testid="affiliate-register-submit-btn">
              {loading ? "Creating account…" : "Apply to Join"}
            </button>
          </form>
          <p className="text-center text-xs text-[#94A3B8] mt-6">
            Already an affiliate? <Link href="/affiliate/signin" className="text-al-primary hover:text-al-primary-hover transition-colors font-medium" data-testid="affiliate-signin-link">Sign in →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
