import Link from "next/link";
import { Shield, Lock, Eye, CheckCircle2, FileText, CreditCard, ArrowRight } from "lucide-react";

import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.trust);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

const TRUST_PILLARS = [
  { icon: CreditCard, title: "Not satisfied? Request a refund", body: "If no dealer submits a competitive offer, you can request a refund of your $99 Auction Access Deposit. Our team reviews every request and, once approved, returns the funds to your original payment method.", accent: "text-[#059669]", bg: "bg-[#ECFDF5]", border: "border-[#A7F3D0]" },
  { icon: Shield, title: "Dealer Vetting & Scoring", body: "Every dealer is licensed, insured, and scored by deal history. Dealers with high junk-fee ratios or low completion rates are removed automatically.", accent: "text-[#0B5FD1]", bg: "bg-[#0B5FD1]/10", border: "border-[#DBEAFE]" },
  { icon: FileText, title: "Contract Shield", body: "Before you sign anything, AutoLenis runs every contract through our Contract Shield engine — scanning for junk fees, unusual add-ons, and compliance issues.", accent: "text-[#0B5FD1]", bg: "bg-[#EFF6FF]", border: "border-[#BFDBFE]" },
  { icon: Lock, title: "Bank-Grade Data Security", body: "Your prequalification data is encrypted with AES-256-GCM at rest. We never share your identity with dealers until you select a deal. FCRA-compliant.", accent: "text-[#0B5FD1]", bg: "bg-[#0B5FD1]/10", border: "border-[#DBEAFE]" },
  { icon: Eye, title: "You Stay Anonymous", body: "Dealers never see your name, contact information, or specific location until the moment you select their offer. Competition stays real. Pressure stays out.", accent: "text-[#0B5FD1]", bg: "bg-[#EFF6FF]", border: "border-[#BFDBFE]" },
  { icon: CheckCircle2, title: "FCRA & TCPA Compliant", body: "All prequalification credit activities comply with the Fair Credit Reporting Act. Communication preferences respected in accordance with TCPA.", accent: "text-[#059669]", bg: "bg-[#ECFDF5]", border: "border-[#A7F3D0]" },
];

export default function TrustPage() {
  return (
    <div className="bg-white">
      <section className="pt-16 py-24 md:py-32 bg-gradient-to-b from-[#F8F9FB] to-white text-center" data-testid="trust-hero">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">Trust & Security</span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-5">We earn trust at every step.</h1>
          <p className="text-[#4B5563] text-lg max-w-xl mx-auto leading-relaxed">AutoLenis was built by people who got tired of buying cars the wrong way. Every feature exists to protect the buyer and hold every party accountable.</p>
        </div>
      </section>

      <section className="py-16 bg-white" data-testid="trust-pillars-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold text-[#111827] mb-12 tracking-tight">Six pillars of buyer protection</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TRUST_PILLARS.map((item) => (
              <div key={item.title} data-testid={`trust-pillar-${item.title.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}`} className={`border rounded-xl p-8 bg-white hover:shadow-sm transition-all ${item.border}`}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-6 ${item.bg}`}>
                  <item.icon size={18} className={item.accent} />
                </div>
                <h3 className="font-bold text-[#111827] mb-3 text-sm">{item.title}</h3>
                <p className="text-xs text-[#4B5563] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-[#F8F9FB]" data-testid="trust-guarantee-section">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <div className="bg-white border-2 border-[#DBEAFE] rounded-2xl p-12 shadow-sm shadow-[#0B5FD1]/5">
            <div className="w-16 h-16 rounded-full bg-[#0B5FD1]/10 flex items-center justify-center mx-auto mb-7 border border-[#DBEAFE]">
              <Shield size={26} className="text-[#0B5FD1]" />
            </div>
            <h2 className="text-2xl font-bold text-[#111827] mb-4 tracking-tight">The AutoLenis Guarantee</h2>
            <p className="text-[#4B5563] leading-relaxed mb-8 text-sm max-w-xl mx-auto">If AutoLenis does not surface at least one offer that is at or below fair market value for your vehicle, you can request a refund of your $99 deposit — our team reviews every request.</p>
            <Link href="/auth/signup" data-testid="trust-get-started-cta" className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-md hover:bg-[#0A4DB8] transition-colors shadow-md shadow-[#0B5FD1]/20">
              Get Started Risk-Free <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
