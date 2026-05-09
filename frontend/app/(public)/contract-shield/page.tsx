import Link from "next/link";
import { Shield, FileSearch, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import FaithVerseModule from "@/components/public/FaithVerseModule";

import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, contractShieldServiceSchema } from "@/lib/seo/jsonld";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.contractShield);
export const dynamic = "force-dynamic";

const SHIELD_SCANS = [
  "Junk fee detection (doc fees, nitro tire charges, VIN etching, etc.)",
  "Add-on product disclosure compliance",
  "Finance rate accuracy vs. pre-qualified band",
  "Dealer reserve markup flags",
  "Extended warranty terms vs. factory coverage",
  "Trade-in valuation discrepancy checks",
  "Payment packing detection",
  "FTC compliance on GAP and F&I products",
];

export default function ContractShieldPage() {
  return (
    <>
      <JsonLd id="contract-shield-jsonld" data={contractShieldServiceSchema()} />
      <section className="bg-[#0B5FD1] py-24 md:py-28 text-center" data-testid="contract-shield-hero">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="w-16 h-16 rounded-full bg-white/15 flex items-center justify-center mx-auto mb-6">
            <Shield size={32} className="text-white" />
          </div>
          <p className="text-xs tracking-widest uppercase font-semibold text-[#50D14E] mb-4">Contract Shield</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight mb-6">
            We read the fine print so you don&apos;t have to.
          </h1>
          <p className="text-white/75 text-lg max-w-xl mx-auto leading-relaxed">Before you sign a single page, AutoLenis scans your entire dealer contract for junk fees, deceptive practices, and compliance issues — then delivers a plain-language verdict so you can proceed with complete confidence.</p>
        </div>
      </section>

      <section className="py-20 bg-white" data-testid="shield-how-section">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl sm:text-3xl font-semibold text-center text-slate-900 mb-14 tracking-tight">How Contract Shield works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { icon: FileSearch, step: "01", title: "Dealer uploads contract", body: "The dealer uploads their sales contract to AutoLenis before sending it to you. They can&apos;t proceed to e-signing without Contract Shield approval." },
              { icon: Shield, step: "02", title: "AutoLenis scans everything", body: "Our scan engine checks for 25+ known junk fee patterns, payment packing, APR mismatches, and FTC compliance requirements." },
              { icon: CheckCircle2, step: "03", title: "You get a plain-language report", body: "Your report shows a PASS, WARNING, or FAIL rating plus a specific list of any flagged items — with plain-English explanations of each concern." },
            ].map((item) => (
              <div key={item.step} data-testid={`shield-step-${item.step}`} className="text-center">
                <div className="w-16 h-16 rounded-full bg-[#0B5FD1]/10 flex items-center justify-center mx-auto mb-4">
                  <item.icon size={24} className="text-[#0B5FD1]" />
                </div>
                <p className="text-4xl font-bold text-[#0B5FD1]/10 mb-2">{item.step}</p>
                <h3 className="font-semibold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-[#F8F9FA]" data-testid="shield-scans-section">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-semibold text-center text-slate-900 mb-10 tracking-tight">What Contract Shield checks</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SHIELD_SCANS.map((item) => (
              <div key={item} className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-700">
                <CheckCircle2 size={15} className="text-[#50D14E] mt-0.5 shrink-0" /> {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <FaithVerseModule pageKey="contract-shield" />
      </div>

      <section className="bg-[#0B5FD1] py-20">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Contract Shield is included in every AutoLenis deal.</h2>
          <Button size="xl" variant="green" data-testid="shield-cta" asChild>
            <Link href="/auth/signup">Start Your Deal <ArrowRight size={18} /></Link>
          </Button>
        </div>
      </section>
    </>
  );
}
