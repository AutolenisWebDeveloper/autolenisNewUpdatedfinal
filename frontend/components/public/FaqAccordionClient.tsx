"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

// ─── FAQ Category Data ────────────────────────────────────────────────────────

const FAQ_CATEGORIES = [
  {
    title: "Getting Started",
    faqs: [
      {
        q: "What is AutoLenis?",
        a: "AutoLenis is a buyer-first automotive fintech platform that uses a private reverse auction to help buyers get competitive offers from vetted dealers — without negotiation, pressure, or wasted time at a dealership.",
      },
      {
        q: "Is AutoLenis a dealership?",
        a: "No. AutoLenis is not a dealer, broker, or lender. We facilitate the auction process between pre-qualified buyers and licensed dealers. All transactions occur directly between the buyer and the dealer.",
      },
      {
        q: "How do I get started?",
        a: "Create a free account, complete your soft-pull prequalification in about 3 minutes, and browse inventory matched to your budget. When you're ready, activate dealer competition with the $99 Auction Access Fee.",
      },
      {
        q: "Does the prequalification affect my credit score?",
        a: "No. AutoLenis uses a soft-pull prequalification through MicroBilt iPredict. Soft pulls do not appear on your credit report and do not impact your score. We are FCRA-compliant.",
      },
      {
        q: "How long does the entire process take?",
        a: "Most buyers complete prequalification, shortlisting, and auction activation in one session. The 48-hour auction window is followed by offer selection, financing, contract review, and e-signing — typically 3–7 days total. Vehicle pickup is scheduled at your convenience.",
      },
    ],
  },
  {
    title: "Pricing",
    faqs: [
      {
        q: "What are the AutoLenis plans?",
        a: "AutoLenis offers two separate options: Standard — a one-time $99 service fee (limited-time launch pricing) — and Premium Concierge at $499 total ($99 to start + $400 at closing). Standard's $99 is a flat service fee; on Premium the $99 starts your auction and the remaining $400 is due at closing.",
      },
      {
        q: "Is the $99 a plan?",
        a: "No. The $99 is a one-time service fee — not a plan, subscription, or platform fee. It activates your private dealer auction and is refundable only if no dealer offers are received within 72 hours.",
      },
      {
        q: "How does the $99 service fee work?",
        a: "The $99 service fee activates your private 48-hour reverse auction and unlocks live dealer bidding and competitive offer access. It is refundable only if no dealer offers are received within 72 hours; otherwise it is non-refundable. On Premium Concierge ($499 total), the $99 starts your auction and the remaining $400 is due at closing.",
      },
    ],
  },
  {
    title: "Dealer Competition",
    faqs: [
      {
        q: "Do I have to accept any offer?",
        a: "No. You review all offers and can accept, decline, or walk away. No commitment is required until you choose to move forward.",
      },
      {
        q: "How many dealers will see my auction?",
        a: "Up to 8 vetted dealers are invited per auction. Dealers are selected based on vehicle match, geographic coverage, historical performance, and current capacity. Each dealer must submit their best offer — they know they are competing.",
      },
      {
        q: "Do dealers know who I am?",
        a: "No. Your identity, contact information, and specific location remain confidential throughout the entire auction. Dealers see only the vehicle specifications and your pre-qualified budget band. Your identity is only revealed when you select a deal.",
      },
      {
        q: "What if no dealer submits an offer?",
        a: "If the auction closes with zero offers within 72 hours — which is rare — your $99 service fee is refunded in full within 3 business days. AutoLenis may also offer to re-run the auction at no additional cost, or route you through our Request a Car program if the vehicle is not commonly available.",
      },
    ],
  },
  {
    title: "Remote Buying",
    faqs: [
      {
        q: "Can I complete the process remotely?",
        a: "Yes. Prequalification, vehicle selection, offer review, and contract e-signing all happen online. Vehicle pickup is scheduled at your convenience using a QR code — minimizing time at the lot.",
      },
      {
        q: "Can I use my own financing?",
        a: "Yes. After selecting a deal, you can choose dealer financing, your own bank or credit union pre-approval, or a cash purchase. AutoLenis supports all three paths.",
      },
    ],
  },
  {
    title: "Platform Features",
    faqs: [
      {
        q: "What is Contract Shield?",
        a: "Contract Shield is AutoLenis's proprietary document review engine. Before you sign anything, we scan every contract for junk fees, unusual add-ons, compliance issues, and deceptive practices. You receive a plain-language report with a PASS, WARNING, or FAIL rating and a specific list of concerns to address.",
      },
    ],
  },
];

// Flat FAQS array (all items combined) — preserved for backward compatibility
export const FAQS = FAQ_CATEGORIES.flatMap((c) => c.faqs);

// ─── FaqItem ──────────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border-b border-[#E5E7EB] last:border-0"
      data-testid={`faq-item-${q.slice(0, 15).replace(/\s+/g, "-").toLowerCase()}`}
    >
      <button
        onClick={() => setOpen(!open)}
        data-testid="faq-toggle-btn"
        className="w-full flex items-center justify-between py-5 text-left gap-4"
      >
        <span className="font-semibold text-[#111827] text-sm">{q}</span>
        {open ? (
          <ChevronUp size={16} className="text-[#94A3B8] shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-[#94A3B8] shrink-0" />
        )}
      </button>
      {open && (
        <p className="text-sm text-[#4B5563] leading-relaxed pb-5">{a}</p>
      )}
    </div>
  );
}

// ─── FaqAccordionClient ───────────────────────────────────────────────────────

export default function FaqAccordionClient() {
  return (
    <div className="mx-auto max-w-3xl px-6">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm divide-y divide-[#E5E7EB]">
        {FAQ_CATEGORIES.map((category) => (
          <div key={category.title} className="px-8 py-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1] mb-4">
              {category.title}
            </h2>
            {category.faqs.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <p className="text-[#4B5563] text-sm mb-3">Still have questions?</p>
        <Link
          href="/contact"
          data-testid="faq-contact-link"
          className="text-sm font-semibold text-[#0B5FD1] hover:underline"
        >
          Contact our team →
        </Link>
      </div>
    </div>
  );
}
