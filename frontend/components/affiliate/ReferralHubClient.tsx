// components/affiliate/ReferralHubClient.tsx
// Feature 23 — Shareable Referral Hub client component
// Real referral code from affiliate profile, social copy templates, native share, QR

"use client";

import { useState } from "react";
import { Copy, Check, Share2, Link2, Twitter, Linkedin, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  referralCode: string;
  referralLink: string;
  affiliateStatus: string;
  qrDataUrl: string;
  l1PerDealCents: number;
  l2PerDealCents: number;
  l3PerDealCents: number;
}

interface SocialTemplate {
  id: string;
  label: string;
  icon: React.ElementType;
  text: string;
}

function buildSocialTemplates(referralCode: string, referralLink: string): SocialTemplate[] {
  return [
    {
      id: "twitter",
      label: "Twitter / X",
      icon: Twitter,
      text: `Skip the dealership stress 🚗\nAutoLenis makes car buying easy — real dealer competition, no negotiation needed.\nUse my link: ${referralLink}\n(Paid affiliate — I earn if you complete a deal)`,
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      icon: Linkedin,
      text: `If you or someone you know is buying a car, check out AutoLenis — a premium car-buying concierge that puts dealers in competition for your business.\n\nMy referral link: ${referralLink} (code: ${referralCode})\n\n*Disclosure: I'm a paid affiliate and earn a commission on completed deals.*`,
    },
    {
      id: "email",
      label: "Email",
      icon: Mail,
      text: `Subject: A smarter way to buy your next car\n\nHey,\n\nI wanted to share AutoLenis — a service that helped me skip dealership back-and-forth and get real competitive offers.\n\nUse my link to get started: ${referralLink}\n\nDisclosure: I earn a commission if you complete a deal through my link.\n\nTalk soon!`,
    },
    {
      id: "sms",
      label: "Text / DM",
      icon: MessageSquare,
      text: `Buying a car soon? Try AutoLenis — dealers compete, you win. Here's my link: ${referralLink} (I get a small commission if you complete a deal 🙏)`,
    },
  ];
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* permission denied */ }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
    >
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
      {copied ? "Copied!" : label}
    </button>
  );
}


export default function ReferralHubClient({ referralCode, referralLink, affiliateStatus, qrDataUrl, l1PerDealCents, l2PerDealCents, l3PerDealCents }: Props) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const templates = buildSocialTemplates(referralCode, referralLink);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch { /* permission denied */ }
  }

  async function handleNativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join AutoLenis",
          text: `Use my referral code ${referralCode} when you sign up for AutoLenis.`,
          url: referralLink,
        });
      } catch { /* user cancelled */ }
    } else {
      handleCopyLink();
    }
  }

  const isActive = affiliateStatus === "ACTIVE";

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="referral-hub-page">
      <div className="flex items-center gap-3 mb-2">
        <Share2 size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Referral Hub</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Share your referral link and earn commissions on completed deals.
      </p>

      {!isActive && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6 text-sm text-amber-800" data-testid="inactive-affiliate-notice">
          Your affiliate account is currently <strong>{affiliateStatus.toLowerCase()}</strong>. Referral commissions are only earned while your account is Active.
        </div>
      )}

      {/* Referral code + link card */}
      <div className="bg-gradient-to-br from-[#0B5FD1] to-[#0A4DB8] rounded-xl p-6 text-white mb-6 relative overflow-hidden"
        data-testid="referral-link-card">
        <div className="absolute top-0 right-0 w-56 h-56 bg-white/5 rounded-full -translate-y-28 translate-x-28 pointer-events-none" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70 mb-4">Your Referral Code</p>
          <p className="text-4xl font-bold font-mono tracking-[0.15em] mb-5" data-testid="hub-referral-code">
            {referralCode}
          </p>
          <p className="text-xs text-white/60 mb-1.5">Shareable link</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-black/20 border border-white/15 rounded-lg px-3 py-2 text-[11px] font-mono text-white/90 truncate"
              data-testid="hub-referral-link">
              {referralLink}
            </code>
            <button type="button" onClick={handleCopyLink}
              data-testid="hub-copy-link-btn"
              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors border border-white/15">
              {copiedLink ? <Check size={15} className="text-[#50D14E]" /> : <Copy size={15} />}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <Button size="sm" onClick={handleNativeShare}
              data-testid="hub-native-share-btn"
              className="bg-white/15 hover:bg-white/25 text-white border border-white/20">
              <Share2 size={13} className="mr-1.5" />Share
            </Button>
            <Button size="sm" onClick={handleCopyLink}
              data-testid="hub-copy-link-btn-2"
              className="bg-white/15 hover:bg-white/25 text-white border border-white/20">
              <Link2 size={13} className="mr-1.5" />{copiedLink ? "Copied!" : "Copy Link"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        {/* Real QR code generated server-side via qrcode package */}
        <div className="flex flex-col items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-5" data-testid="qr-display">
          <img src={qrDataUrl} alt="Referral QR code — scan to open your referral signup link" width={200} height={200} className="rounded-lg" />
          <p className="text-xs text-slate-500 text-center max-w-[160px]">
            Scan to open your referral signup link
          </p>
        </div>

        {/* Stats / earning preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col gap-3" data-testid="earning-preview">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">What you earn</p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">L1 direct referral</span>
              <span className="font-semibold text-green-600">${(l1PerDealCents / 100).toFixed(2)} / deal</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">L2 sub-affiliate</span>
              <span className="font-semibold text-green-600">${(l2PerDealCents / 100).toFixed(2)} / deal</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">L3 sub-affiliate</span>
              <span className="font-semibold text-green-600">${(l3PerDealCents / 100).toFixed(2)} / deal</span>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 mt-auto">
            15% / 3% / 2% of $499 fee. Rates set by platform constants.
          </p>
        </div>
      </div>

      {/* Social copy templates */}
      <div data-testid="social-templates">
        <p className="text-sm font-semibold text-slate-800 mb-3">Ready-to-share copy</p>
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              data-testid={`social-template-${t.id}`}>
              <button
                type="button"
                onClick={() => setExpandedTemplate(expandedTemplate === t.id ? null : t.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                data-testid={`template-toggle-${t.id}`}
              >
                <t.icon size={16} className="text-[#0B5FD1] shrink-0" />
                <span className="flex-1 text-sm font-medium text-slate-700">{t.label}</span>
                <CopyButton text={t.text} label="Copy" testId={`copy-template-${t.id}-btn`} />
              </button>
              {expandedTemplate === t.id && (
                <div className="border-t border-slate-100 px-5 py-4 bg-slate-50"
                  data-testid={`template-content-${t.id}`}>
                  <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {t.text}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 text-center mt-4">
          All templates include FTC-required affiliate disclosure. Customize before sending.
        </p>
      </div>
    </div>
  );
}
