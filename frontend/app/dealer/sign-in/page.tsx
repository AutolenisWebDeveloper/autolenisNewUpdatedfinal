"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Gavel, Car, TrendingUp } from "lucide-react";
import Link from "next/link";
import { AutoLenisLogo } from "@/components/shared/AutoLenisLogo";

const DEALER_BULLETS = [
  { icon: Gavel,      text: "Live auction queue with real-time bid updates" },
  { icon: Car,        text: "Full inventory management across all your lanes" },
  { icon: TrendingUp, text: "Lead pipeline tracked from inquiry to closed deal" },
];

export default function DealerSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeAuctions, setActiveAuctions] = useState<number | null>(null);

  // Read and validate the post-login redirect destination.
  // Only allow internal paths to prevent open-redirect attacks:
  // - must start with "/"
  // - must NOT be protocol-relative ("//example.com")
  // - must NOT contain "@" (username injection: "/user@evil.com")
  // - must NOT contain backslash (normalization bypass: "/\evil.com")
  const [redirectPath, setRedirectPath] = useState("/dealer/dashboard");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("redirect") ?? "";
    const isSafe =
      raw.length > 0 &&
      raw.startsWith("/") &&
      !raw.startsWith("//") &&
      !raw.includes("@") &&
      !raw.includes("\\");
    if (isSafe) {
      setRedirectPath(raw);
    }
  }, []);

  // Fetch live active auction count for the social-proof tile.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/platform-stats", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json() as { data?: { activeAuctions?: number } };
        if (!cancelled && typeof json?.data?.activeAuctions === "number") {
          setActiveAuctions(json.data.activeAuctions);
        }
      } catch {
        // Silent — fallback to placeholder copy.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/dealer/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        // Show specific message for suspended/terminated (403) vs wrong credentials (401)
        if (res.status === 403) {
          setError(data.error ?? "Your account is not active. Please contact support.");
        } else {
          // Never reveal whether the email exists — single generic error.
          setError("Incorrect email or password.");
        }
      } else {
        router.push(redirectPath);
        router.refresh();
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-white" data-testid="dealer-signin-page">

      {/* ── Left panel — branded hero (desktop only) ─────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-col justify-between p-14 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-al-primary via-al-primary-hover to-[#2667BF]" />
        <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,_#ffffff10_0px,_#ffffff10_1px,_transparent_1px,_transparent_40px)]" />

        {/* Logo */}
        <div className="relative">
          <AutoLenisLogo size="md" variant="light" href="/" testId="dealer-signin-brand-logo" />
        </div>

        {/* Hero copy */}
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#50D14E] mb-4">Dealer Portal</p>
          <h1 className="text-4xl font-semibold text-white mb-4 leading-tight tracking-tight">
            Welcome back.<br />Your auction queue is ready.
          </h1>
          <p className="text-white/80 text-sm leading-relaxed mb-10 max-w-md">
            Manage your listings, bid on inventory, and track every lead — all in one place.
          </p>

          {/* Live stat */}
          <div
            className="bg-white/10 backdrop-blur border border-white/15 rounded-xl p-5 mb-10"
            data-testid="dealer-signin-live-stat"
          >
            <p className="text-xs text-white/65 uppercase tracking-wider mb-1">Right now</p>
            <p className="text-2xl font-bold text-white font-[family-name:var(--font-mono)] tracking-tight">
              {activeAuctions !== null ? `${activeAuctions.toLocaleString()} auctions active` : "Live auction queue"}
            </p>
            <p className="text-sm text-white/70 mt-1">
              Join the dealers bidding on vehicles in your lanes — or list one of your own.
            </p>
          </div>

          {/* Dealer-specific bullets */}
          <ul className="space-y-4">
            {DEALER_BULLETS.map((b) => (
              <li key={b.text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0 border border-white/25">
                  <b.icon size={14} className="text-white" />
                </div>
                <span className="text-sm text-white/85">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="relative">
          <p className="text-xs text-white/70">
            Not a dealer yet?{" "}
            <Link
              href="/dealer/apply"
              className="text-white hover:text-[#50D14E] transition-colors underline"
              data-testid="dealer-signin-apply-link"
            >
              Apply →
            </Link>
          </p>
        </div>
      </div>

      {/* ── Right panel — form ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile-only branded top bar (72px) */}
        <div className="lg:hidden h-[72px] bg-gradient-to-r from-al-primary to-al-primary-hover flex items-center px-6">
          <AutoLenisLogo size="sm" variant="light" href="/" testId="dealer-signin-mobile-logo" />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 lg:px-12 py-10 lg:py-0">
          <div className="w-full max-w-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-al-primary mb-4">Dealer Portal</p>
            <h2 className="text-2xl font-bold text-[#111827] mb-1 tracking-tight">Sign in to your account</h2>
            <p className="text-sm text-[#94A3B8] mb-8">Access your auction queue, inventory, and leads.</p>

            <form onSubmit={handleSubmit} data-testid="dealer-signin-form" className="space-y-5">
              <div>
                <label
                  htmlFor="dealer-signin-email"
                  className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-2"
                >
                  Email
                </label>
                <input
                  id="dealer-signin-email"
                  data-testid="dealer-signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dealer@example.com"
                  className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors"
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="dealer-signin-password"
                    className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider"
                  >
                    Password
                  </label>
                  <Link
                    href="/dealer/forgot-password"
                    className="text-xs text-[#94A3B8] hover:text-al-primary transition-colors"
                    data-testid="dealer-forgot-password-link"
                  >
                    Forgot?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="dealer-signin-password"
                    data-testid="dealer-signin-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:border-al-primary/50 focus:ring-2 focus:ring-al-primary/10 transition-colors pr-11"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-pressed={showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus rounded transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <label
                className="flex items-center gap-2 select-none cursor-pointer"
                data-testid="dealer-signin-remember-label"
              >
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  data-testid="dealer-signin-remember-checkbox"
                  className="h-4 w-4 rounded border-[#D8C7EE] text-al-primary focus:ring-al-primary/30"
                />
                <span className="text-xs text-[#4B5563]">Remember me for 30 days</span>
              </label>

              {error && (
                <div
                  className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-md"
                  data-testid="signin-error"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                data-testid="dealer-signin-submit"
                className="w-full py-3.5 bg-al-primary text-white font-bold text-sm rounded-md hover:bg-al-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-al-primary/20"
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-[#E5E7EB] grid grid-cols-2 gap-3 text-center">
              <Link
                href="/dealer/apply"
                className="text-xs text-[#94A3B8] hover:text-al-primary transition-colors"
                data-testid="dealer-signin-apply-to-join-link"
              >
                Apply to join →
              </Link>
              <Link
                href="/dealer/invite/claim"
                className="text-xs text-[#94A3B8] hover:text-al-primary transition-colors"
                data-testid="dealer-signin-claim-invite-link"
              >
                Claim invitation →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
