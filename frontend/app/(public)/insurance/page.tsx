import type { Metadata } from "next";
import Link from "next/link";
import { Shield, CheckCircle2, ArrowRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.insurance);

const COVERAGE_OPTIONS = [
  { title: "Get a quote through AutoLenis", body: "We partner with licensed insurance providers. Get a real premium estimate as part of your deal flow — no separate applications required.", cta: "Get a Quote", href: "/auth/signup", tag: "Recommended" },
  { title: "Use your own insurance", body: "Already have an auto insurance policy? Upload proof of coverage and we will verify it instantly. Your deal can proceed immediately.", cta: "Upload Proof", href: "/auth/signup", tag: null },
];

export default function InsurancePage() {
  return (
    <>
      <section className="bg-[#0B5FD1] py-24 md:py-28" data-testid="insurance-hero">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#50D14E] mb-4">Insurance</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight max-w-2xl mb-6 leading-[1.1]">
            Coverage sorted before you pick up the keys.
          </h1>
          <p className="text-white/75 text-lg max-w-xl leading-relaxed">Most lenders require proof of insurance before releasing a vehicle. AutoLenis coordinates this as part of your deal flow — whether you want a competitive new quote or already have coverage you trust.</p>
        </div>
      </section>

      <section className="py-20 bg-white" data-testid="insurance-options-section">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-2xl font-semibold text-slate-900 text-center mb-12 tracking-tight">Two paths to coverage</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {COVERAGE_OPTIONS.map((opt) => (
              <div key={opt.title} data-testid={`insurance-option-${opt.title.slice(0, 10).replace(/\s+/g, "-").toLowerCase()}`}
                className="border-2 border-slate-200 rounded-2xl p-8 hover:border-[#0B5FD1] hover:shadow-lg transition-all duration-300">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[#0B5FD1]/10 flex items-center justify-center">
                    {opt.tag ? <Shield size={22} className="text-[#0B5FD1]" /> : <Upload size={22} className="text-[#0B5FD1]" />}
                  </div>
                  {opt.tag && <span className="text-xs font-semibold bg-[#50D14E]/15 text-green-700 px-2.5 py-1 rounded-full">{opt.tag}</span>}
                </div>
                <h3 className="font-semibold text-slate-900 text-lg mb-3">{opt.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-6">{opt.body}</p>
                <Button variant="secondary" data-testid={`insurance-cta-${opt.title.slice(0, 10).replace(/\s+/g, "-").toLowerCase()}`} asChild>
                  <Link href={opt.href}>{opt.cta} <ArrowRight size={14} /></Link>
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-12 bg-[#F8F9FA] rounded-xl p-6" data-testid="insurance-note">
            <div className="flex gap-3">
              <CheckCircle2 size={18} className="text-[#50D14E] shrink-0 mt-0.5" />
              <p className="text-sm text-slate-600 leading-relaxed">
                <strong>Important:</strong> Insurance does not block your auction. You can activate your auction and browse deals before arranging coverage. Insurance is required only at the financing stage — before you can complete your purchase.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
