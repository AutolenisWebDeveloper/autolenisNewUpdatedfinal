"use client";

import { useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";

interface Props {
  referralCode: string;
  referralLink: string;
}

export default function ReferralCodeCard({ referralCode, referralLink }: Props) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const l1PerDeal = ((PREMIUM_FEE_CENTS / 100) * COMMISSION_RATES.LEVEL_1).toFixed(2);
  const feeDollars = (PREMIUM_FEE_CENTS / 100).toFixed(0);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch { /* clipboard permission denied */ }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch { /* clipboard permission denied */ }
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join AutoLenis",
          text: `Use my referral code ${referralCode} when you sign up — you'll get premium car-buying support.`,
          url: referralLink,
        });
      } catch { /* user cancelled */ }
    } else {
      copyLink();
    }
  }

  return (
    <div
      className="bg-gradient-to-br from-al-primary to-al-primary-hover rounded-xl p-6 mb-6 text-white relative overflow-hidden"
      data-testid="referral-code-card"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32 pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70">Your referral code</p>
          <button
            type="button"
            onClick={nativeShare}
            className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-white/20"
            data-testid="native-share-btn"
          >
            <Share2 size={12} />
            Share
          </button>
        </div>

        {/* The code */}
        <div className="flex items-center gap-3 mb-5">
          <p
            className="text-4xl font-bold font-[family-name:var(--font-mono)] tracking-[0.15em]"
            data-testid="referral-code-display"
          >
            {referralCode}
          </p>
          <button
            type="button"
            onClick={copyCode}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors border border-white/15"
            aria-label="Copy referral code"
            data-testid="copy-referral-code-btn"
          >
            {copiedCode ? <Check size={15} className="text-[#059669]" /> : <Copy size={15} />}
          </button>
        </div>

        {/* Shareable link */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-1.5">Shareable link</p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 bg-black/20 border border-white/15 rounded-lg px-3 py-2 text-[11px] font-mono text-white/90 truncate"
              data-testid="referral-link-display"
            >
              {referralLink}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 bg-white text-al-primary-hover hover:bg-[#F8F9FB] text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0"
              data-testid="copy-referral-link-btn"
            >
              {copiedLink ? (<><Check size={12} /> Copied</>) : (<><Copy size={12} /> Copy</>)}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-white/70 mt-3">
          When a buyer completes a deal using your code, you earn{" "}
          <strong className="text-[#059669]">${l1PerDeal}</strong>{" "}
          ({Math.round(COMMISSION_RATES.LEVEL_1 * 100)}% of the ${feeDollars} fee).
        </p>
      </div>
    </div>
  );
}
