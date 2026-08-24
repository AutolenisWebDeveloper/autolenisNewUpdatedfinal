import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Deal" };

import { requireBuyer } from "@/lib/auth/session";
import { dealStatusLabel, dealStatusTone } from "@/lib/domain/status-labels";
import { buyerFacingDealerName } from "@/lib/services/offer/dealer-display";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowRight, Car } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: {
      offer: { include: { dealer: { select: { dealershipName: true, tier: true, isSystemPlaceholder: true } } } },
      vehicleRequestOffer: { select: { priceCents: true, vehicleInfo: true, notes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!deal) {
    return (
      <div className="p-6 md:p-8 max-w-lg text-center" data-testid="deal-page-no-deal">
        <Car size={32} className="text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-slate-900 mb-2">No active deal</h1>
        <p className="text-slate-500 text-sm mb-6">Select an offer from your auction to start a deal.</p>
        <Button variant="secondary" href="/buyer/auctions" data-testid="goto-auctions-btn">View My Auctions</Button>
      </div>
    );
  }

  const otdPriceCents = deal.offer?.otdPriceCents ?? deal.vehicleRequestOffer?.priceCents ?? 0;
  const dealerName = buyerFacingDealerName(deal.offer);

  const steps = [
    { label: "Deal Selected", done: true },
    { label: "Financing", done: !!deal.financingPath, href: "/buyer/deal/financing" },
    { label: "Service Fee", done: !!deal.feePaidAt || buyer.plan !== "PREMIUM", href: "/buyer/deal/payment" },
    { label: "Insurance", done: deal.insuranceStatus !== "NOT_STARTED", href: "/buyer/insurance" },
    { label: "Contract Shield", done: deal.contractShieldStatus === "PASS", href: "/buyer/contract-shield" },
    { label: "Sign Documents", done: deal.status === "SIGNED" || deal.status === "COMPLETED", href: "/buyer/esign" },
    { label: "Pickup", done: deal.status === "COMPLETED", href: "/buyer/pickup" },
  ];

  const nextStep = steps.find(s => !s.done && s.href);

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deal-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My Deal</h1>
          <p className="text-sm text-[#6B7280] mt-0.5" data-testid="deal-dealer-context">
            {dealerName}
          </p>
        </div>
        <Badge variant={dealStatusTone(deal.status) === "success" ? "green" : dealStatusTone(deal.status) === "danger" ? "destructive" : "blue"}>{dealStatusLabel(deal.status)}</Badge>
      </div>

      {/* Price summary */}
      <div className="bg-al-primary text-white rounded-2xl p-6 mb-6" data-testid="deal-price-summary">
        <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Your Deal</p>
        <p className="text-3xl font-bold">${(otdPriceCents / 100).toLocaleString()}</p>
        <p className="text-sm text-white/60 mt-1">Out-the-door price</p>
      </div>

      {/* Progress steps */}
      <div className="space-y-2 mb-6">
        {steps.map((step, i) => (
          <div key={i} data-testid={`deal-step-${step.label.toLowerCase().replace(/\s+/g, "-")}`}
            className={`flex items-center justify-between p-4 rounded-xl border ${step.done ? "bg-green-50 border-green-200" : "bg-white border-slate-200"}`}>
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step.done ? "bg-green-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                {step.done ? "✓" : i + 1}
              </div>
              <span className={`text-sm font-medium ${step.done ? "text-green-700" : "text-slate-700"}`}>{step.label}</span>
            </div>
            {!step.done && step.href && <Link href={step.href} className="text-xs text-al-primary font-semibold">Continue →</Link>}
          </div>
        ))}
      </div>

      {nextStep && (
        <Button className="w-full" href={nextStep.href} data-testid="deal-next-step-btn">
          Next: {nextStep.label} <ArrowRight size={15} />
        </Button>
      )}

      {/* Review flow — captured at peak satisfaction (post-purchase) */}
      {deal.status === "COMPLETED" && (
        <div
          className="bg-green-50 border border-green-200 rounded-2xl p-5 mt-4"
          data-testid="deal-review-prompt"
        >
          <p className="font-semibold text-green-800 mb-2">
            Your vehicle purchase is complete.
          </p>
          <p className="text-sm text-green-700 mb-3">
            We hope you love your new vehicle. Would you share your AutoLenis
            experience to help other buyers?
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://g.page/r/autolenis/review"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold bg-white border border-green-200 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-50"
              data-cta="leave-google-review"
            >
              Leave a Google Review →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
