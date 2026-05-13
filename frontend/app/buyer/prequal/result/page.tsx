import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prequalification Result", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { formatCents } from "@/lib/utils";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function PrequalResultPage() {
  const buyer = await requireBuyer();
  const prequal = buyer?.preQualification;
  if (!prequal || prequal.decision === "DECLINED") redirect("/buyer/prequal/declined");
  if (prequal.decision === "MANUAL_REVIEW" || prequal.decision === "OFAC_ESCALATED") redirect("/buyer/prequal/pending");
  if (prequal.decision !== "APPROVED") redirect("/buyer/prequal");

  const tierLabels: Record<string, string> = {
    STRONG: "Strong", GOOD: "Good", FAIR: "Fair", WEAK: "Weak",
  };

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="prequal-result-page">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">You&apos;re pre-qualified</h1>
        <p className="text-slate-500 text-sm">Here&apos;s your approved buying power</p>
      </div>

      <div className="bg-[#0B5FD1] rounded-2xl p-8 text-white text-center mb-6" data-testid="prequal-budget-display">
        <p className="text-xs tracking-widest uppercase text-white/60 mb-2">Your Approved Budget</p>
        <p className="text-5xl font-bold mb-2">{formatCents(prequal.maxOtdAmountCents)}</p>
        <p className="text-sm text-white/60">Maximum out-the-door price</p>
        {prequal.tier && (
          <div className="mt-4 inline-block bg-white/20 px-4 py-1.5 rounded-full text-sm font-semibold">
            {tierLabels[prequal.tier]} Credit Profile
          </div>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6 text-sm text-slate-600">
        <p className="font-semibold text-slate-800 mb-1">What this means</p>
        <ul className="space-y-1.5 text-sm text-slate-500">
          <li>• Your search results will show only vehicles within this budget</li>
          <li>• This approval is valid for 30 days from today</li>
          <li>• No credit score impact was made during this check</li>
          <li>• This is not a loan commitment — financing is selected after auction</li>
        </ul>
      </div>

      {/* How your budget was calculated — builds trust */}
      <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 mt-6"
        data-testid="prequal-calculation-breakdown">
        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4">
          How your budget was determined
        </p>
        <div className="space-y-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-[#4B5563]">Monthly income (adjusted)</span>
            <span className="font-medium text-[#111827]">
              Used for capacity calculation
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#4B5563]">Max auto payment (20% DTI rule)</span>
            <span className="font-medium text-[#111827]">
              Industry-standard benchmark
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#4B5563]">Benchmark: 7% APR · 72 months</span>
            <span className="font-medium text-[#111827]">Conservative estimate</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#4B5563]">Credit profile validation</span>
            <span className="font-medium text-[#111827]">Soft pull · MicroBilt iPredict</span>
          </div>
          <div className="flex justify-between border-t border-[#E5E7EB] pt-3 font-bold">
            <span className="text-[#111827]">Approved OTD budget</span>
            <span className="text-[#0B5FD1] text-lg">
              ${(prequal.maxOtdAmountCents / 100).toLocaleString()}
            </span>
          </div>
        </div>
        <p className="text-xs text-[#9CA3AF] mt-4 leading-relaxed">
          Your actual rate and terms are set by your lender.
          This is a pre-qualification estimate, not a final loan commitment.
          Valid for 30 days · Soft pull only · No credit score impact
        </p>
      </div>

      {prequal.maxOtdAmountCents === 3500000 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-xs text-amber-700">
          Your pre-qualification amount is based on the income you provided.
          To update your pre-qualification, re-submit with your current income.
        </div>
      )}

      <p className="text-xs text-slate-400 text-center mb-6">
        Expires: {prequal.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
      </p>

      <Button className="w-full" size="lg" href="/buyer/search" data-testid="prequal-result-search-btn">
        Browse Vehicles Within My Budget <ArrowRight size={16} />
      </Button>
    </div>
  );
}
