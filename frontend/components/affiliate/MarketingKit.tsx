"use client";

import { useState } from "react";
import { Check, Copy, Mail, Linkedin, Instagram, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  referralCode: string;
  referralLink: string;
}

interface Template {
  id: string;
  category: string;
  icon: React.ElementType;
  title: string;
  desc: string;
  content: string;
}

function buildTemplates(referralCode: string, referralLink: string): Template[] {
  return [
    {
      id: "email-personal",
      category: "Email",
      icon: Mail,
      title: "Personal Outreach Email",
      desc: "Direct email to someone you know buying a car",
      content: `Subject: I found something that actually helped me buy my car smarter

Hey [Name],

I wanted to share something with you — I've been using AutoLenis, a premium car-buying service that helped me find and close a deal on a car without the dealership runaround.

If you're in the market for a car (or know someone who is), here's my referral link:

${referralLink}

Use code ${referralCode} at signup.

Disclosure: I'm an affiliate for AutoLenis and earn a commission if you complete a deal.

Happy to answer any questions!

[Your name]`,
    },
    {
      id: "email-broadcast",
      category: "Email",
      icon: Mail,
      title: "Broadcast / Newsletter",
      desc: "For a list or newsletter audience",
      content: `Subject: Skip the dealership stress — here's how

If you've ever felt overwhelmed buying a car, you're not alone.

AutoLenis is a premium car-buying concierge that handles negotiations, research, and deal coordination for you — so you can buy with confidence.

👉 Get started here: ${referralLink}
Use code ${referralCode}

*Disclosure: I earn a commission if you complete a deal through my link.*`,
    },
    {
      id: "linkedin",
      category: "LinkedIn",
      icon: Linkedin,
      title: "LinkedIn Post",
      desc: "Professional network post",
      content: `Buying a car is one of the most stressful financial decisions most people make.

I've been partnering with AutoLenis — a premium car-buying platform that takes the guesswork out of it.

If you or someone you know is in the market, use my link:
${referralLink} (code: ${referralCode})

*Disclosure: I'm a paid affiliate and earn a commission on completed deals.*`,
    },
    {
      id: "instagram",
      category: "Instagram",
      icon: Instagram,
      title: "Instagram / Facebook Caption",
      desc: "Short social post for IG or FB",
      content: `Car shopping doesn't have to be a nightmare 🚗✨

AutoLenis is a premium car-buying concierge — real research, real negotiations, real results.

Link in bio → or visit ${referralLink}
Use code ${referralCode}

#CarBuying #AutoLenis #SmartShopping

*Paid partnership / affiliate disclosure*`,
    },
    {
      id: "sms",
      category: "Text / DM",
      icon: MessageSquare,
      title: "Text Message / DM",
      desc: "Short message to send directly",
      content: `Hey! If you're buying a car, check out AutoLenis — it's a premium concierge service that actually works. Here's my link: ${referralLink} (use code ${referralCode}). Heads up: I earn a referral commission if you complete a deal.`,
    },
    {
      id: "ftc-disclosure",
      category: "Compliance",
      icon: Copy,
      title: "FTC Disclosure (Standard)",
      desc: "Include in all posts and content — required by FTC",
      content: `Disclosure: I am an affiliate partner of AutoLenis. I may earn a commission if you purchase a plan through my referral link at no additional cost to you.`,
    },
  ];
}

function CopyButton({ text, testId }: { text: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied */ }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0B5FD1]/10 text-[#0B5FD1] hover:bg-[#0B5FD1]/20 transition-colors shrink-0"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function MarketingKit({ referralCode, referralLink }: Props) {
  const templates = buildTemplates(referralCode, referralLink);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const categories = ["Email", "LinkedIn", "Instagram", "Text / DM", "Compliance"];

  return (
    <div className="space-y-8" data-testid="marketing-kit">
      {categories.map((cat) => {
        const items = templates.filter((t) => t.category === cat);
        return (
          <div key={cat}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              {cat}
            </p>
            <div className="space-y-3">
              {items.map((t) => {
                const isOpen = expandedId === t.id;
                return (
                  <div
                    key={t.id}
                    data-testid={`resource-item-${t.id}`}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                  >
                    {/* Header row */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : t.id)}
                      data-testid={`resource-toggle-${t.id}`}
                      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-[#0B5FD1]/8 rounded-lg">
                          <t.icon size={14} className="text-[#0B5FD1]" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{t.title}</p>
                          <p className="text-xs text-slate-400">{t.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <CopyButton text={t.content} testId={`copy-btn-${t.id}`} />
                        {isOpen ? (
                          <ChevronUp size={16} className="text-slate-400" />
                        ) : (
                          <ChevronDown size={16} className="text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Expanded content */}
                    {isOpen && (
                      <div className="border-t border-slate-100 px-5 py-4 bg-slate-50" data-testid={`resource-content-${t.id}`}>
                        <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                          {t.content}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-slate-400 text-center mt-4">
        All templates include FTC-required affiliate disclosure language. Customize before sending.
      </p>
    </div>
  );
}
