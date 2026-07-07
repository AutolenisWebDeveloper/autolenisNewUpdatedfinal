"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function ReferralLinkCopy({ referralLink }: { referralLink: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralLink);
    } catch {
      // Fallback for browsers without Clipboard API (deprecated execCommand, kept for compatibility)
      const el = document.createElement("textarea");
      el.value = referralLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2" data-testid="referral-link-section">
      <code
        className="flex-1 text-xs bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 text-[#374151] truncate"
        data-testid="referral-link"
      >
        {referralLink}
      </code>
      <button
        onClick={handleCopy}
        className="p-2 text-al-primary hover:bg-al-primary-subtle rounded-lg transition-colors"
        data-testid="copy-referral-link-btn"
        aria-label="Copy referral link"
      >
        {copied ? <Check size={16} className="text-[#10B981]" /> : <Copy size={16} />}
      </button>
    </div>
  );
}
