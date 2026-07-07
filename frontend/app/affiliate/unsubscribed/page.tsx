// Unsubscribe confirmation page — public, no layout auth dependency.

import Link from "next/link";
import { CheckCircle2, AlertCircle, Info, ShieldAlert } from "lucide-react";

export default async function UnsubscribedPage({ searchParams }: { searchParams: Promise<{ status?: string; reason?: string }> }) {
  const { status = "success", reason } = await searchParams;

  // Suspended account — shown when requireAffiliate() redirects here
  if (reason === "suspended") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD] flex items-center justify-center p-6" data-testid="affiliate-unsubscribed-page">
        <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl p-10 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 border text-slate-700 bg-slate-100 border-slate-300">
            <ShieldAlert size={26} />
          </div>
          <h1 className="text-xl font-bold text-[#111827] mb-2 tracking-tight" data-testid="unsubscribed-title">
            Your affiliate account has been suspended
          </h1>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-6" data-testid="unsubscribed-message">
            Access to the affiliate portal is temporarily restricted. Please contact{" "}
            <a href="mailto:support@autolenis.com" className="text-al-primary font-semibold hover:underline">
              support@autolenis.com
            </a>{" "}
            to discuss your account status.
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <Link href="/" className="text-[#94A3B8] hover:text-al-primary transition-colors text-xs">Return to AutoLenis</Link>
          </div>
        </div>
      </div>
    );
  }

  const config: Record<string, { icon: typeof CheckCircle2; title: string; message: string; tone: string }> = {
    success: {
      icon: CheckCircle2,
      title: "You're unsubscribed",
      message: "You won't receive the weekly affiliate digest anymore. Transactional emails (payouts, commission confirmations, account alerts) will still be sent.",
      tone: "text-[#1A6B18] bg-[#50D14E]/10 border-[#50D14E]/30",
    },
    already: {
      icon: Info,
      title: "Already unsubscribed",
      message: "You had already opted out of the weekly digest. No change was made.",
      tone: "text-[#2667BF] bg-[#2667BF]/10 border-[#2667BF]/30",
    },
    invalid: {
      icon: AlertCircle,
      title: "Invalid link",
      message: "This unsubscribe link is invalid or has expired. If you'd like to stop receiving the digest, please contact support.",
      tone: "text-red-700 bg-red-50 border-red-200",
    },
  };
  const c = config[status] ?? config.success;
  const Icon = c.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD] flex items-center justify-center p-6" data-testid="affiliate-unsubscribed-page">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl p-10 text-center shadow-sm">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 border ${c.tone}`}>
          <Icon size={26} />
        </div>
        <h1 className="text-xl font-bold text-[#111827] mb-2 tracking-tight" data-testid="unsubscribed-title">{c.title}</h1>
        <p className="text-sm text-[#4B5563] leading-relaxed mb-6" data-testid="unsubscribed-message">{c.message}</p>
        <div className="flex flex-col gap-2 text-sm">
          <Link href="/affiliate/portal/dashboard" className="text-al-primary font-semibold hover:underline" data-testid="back-to-dashboard-link">
            Back to dashboard →
          </Link>
          <Link href="/" className="text-[#94A3B8] hover:text-al-primary transition-colors text-xs">Return to AutoLenis</Link>
        </div>
      </div>
    </div>
  );
}
