"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, Gavel, Lock, RefreshCw, Shield } from "lucide-react";

import { trackFunnelEvent } from "@/lib/analytics/funnel-events";

export default function ThankYouClient() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const campaign = params.get("campaign") ?? "unknown";

  useEffect(() => {
    trackFunnelEvent("ty_view", { campaign });
    if (typeof window !== "undefined") {
      window.fbq?.("track", "Lead", { currency: "USD", value: 0 });
      window.ttq?.track("SubmitForm");
      window.AutoLenisAnalytics?.trackVehicleRequest?.();
    }
    // CRM timeline: log the thank-you view if we have an email. Fire-and-forget.
    if (email) {
      fetch("/api/public/crm/thank-you-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, campaign }),
      }).catch(() => {});
    }
  }, [email, campaign]);

  return (
    <main className="min-h-screen bg-[#F8F9FB] py-12 px-5">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 mb-2 tracking-tight">
            Request Received.
          </h1>
          <p className="text-slate-500 max-w-md mx-auto">
            We received your vehicle request. The next step activates your private dealer auction.
          </p>
        </div>

        {/* PRIMARY CONVERSION: deposit activation */}
        <div className="bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] rounded-3xl p-7 text-white shadow-2xl shadow-blue-900/20 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Gavel size={18} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">
              Next step — Activate your auction
            </span>
          </div>
          <h2 className="text-2xl font-black mb-3 leading-tight">
            Unlock dealer competition with a refundable $99 deposit.
          </h2>
          <p className="text-blue-100 text-sm mb-5 leading-relaxed">
            Your auction is prepared but inactive. The $99 Auction Access Deposit signals seriousness
            to verified dealers, unlocks competitive bidding from up to 8 dealers, and is fully
            refunded if you decline every offer.
          </p>
          <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-5 space-y-2">
            {[
              { icon: <RefreshCw size={14} />, text: "100% refundable if no offer is selected" },
              { icon: <Shield size={14} />,    text: "Credited toward your vehicle purchase at closing (Standard plan)" },
              { icon: <Clock size={14} />,     text: "Activates a 48-hour dealer auction immediately" },
              { icon: <Lock size={14} />,      text: "Processed securely through Stripe — never stored by AutoLenis" },
            ].map((item) => (
              <div key={item.text} className="flex items-start gap-2 text-sm text-blue-50">
                <span className="text-white/70 mt-0.5">{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          <Link
            href={`/auth/signup?plan=standard&source=lp${email ? `&email=${encodeURIComponent(email)}` : ""}`}
            data-testid="thank-you-activate-cta"
            onClick={() => trackFunnelEvent("ty_activate_cta_click", { campaign })}
            className="block w-full bg-white text-[#0B5FD1] font-black text-base text-center py-4 rounded-2xl hover:bg-blue-50 transition-all shadow-lg"
          >
            Activate My Dealer Auction →
          </Link>
          <p className="text-[11px] text-white/60 text-center mt-3">
            Or upgrade to Premium concierge —{" "}
            <Link href="/pricing" className="underline hover:text-white">
              see plan comparison
            </Link>
          </p>
        </div>

        {/* WHAT HAPPENS NEXT */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-4">
            What happens after activation
          </h3>
          <div className="space-y-4">
            {[
              {
                step: "1",
                title: "Auction goes live within minutes",
                body:
                  "AutoLenis invites verified dealers within 150 miles. The 48-hour countdown begins.",
              },
              {
                step: "2",
                title: "Dealers compete — you don't",
                body:
                  "Each dealer submits a structured offer: cash OTD price, financing terms, fee breakdown. No phone calls. No pressure.",
              },
              {
                step: "3",
                title: "Best Price Engine ranks the offers",
                body:
                  "Best Cash, Best Monthly, and Best Overall Value — compared side-by-side. Dealer identity stays anonymized until you choose.",
              },
              {
                step: "4",
                title: "You choose. Or walk away.",
                body:
                  "Select the offer that works. Or decline all of them — full $99 refund, no questions asked.",
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-[#0B5FD1]/10 text-[#0B5FD1] font-bold text-sm flex items-center justify-center shrink-0">
                  {item.step}
                </div>
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{item.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">
          A confirmation has been sent to{" "}
          <strong className="text-slate-600">{email || "your inbox"}</strong>.
          Check your spam folder if it does not arrive within 5 minutes.
        </p>
      </div>
    </main>
  );
}
