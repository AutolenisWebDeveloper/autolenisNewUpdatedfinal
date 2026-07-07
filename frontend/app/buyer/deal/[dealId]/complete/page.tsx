import type { Metadata } from "next";

export const metadata: Metadata = { title: "Deal Complete", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { CheckCircle2, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import TestimonialPromptClient from "@/components/buyer/TestimonialPromptClient";

interface Props { params: Promise<{ dealId: string }> }

export default async function DealCompletePage({ params }: Props) {
  const { dealId } = await params;
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id, status: "COMPLETED" },
    include: {
      offer: { include: { dealer: true } },
      vehicleRequestOffer: { select: { priceCents: true, vehicleInfo: true, notes: true } },
    },
  });
  if (!deal) notFound();

  const otdPriceCents = deal.offer?.otdPriceCents ?? deal.vehicleRequestOffer?.priceCents ?? 0;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deal-complete-page">
      <div className="text-center mb-8">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={40} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Congratulations!</h1>
        <p className="text-slate-500">Your vehicle purchase is complete.</p>
      </div>

      <div className="bg-al-primary text-white rounded-2xl p-6 mb-6" data-testid="deal-complete-summary">
        <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Deal Summary</p>
        <p className="text-2xl font-bold mb-1">${(otdPriceCents / 100).toLocaleString()}</p>
        <p className="text-sm text-white/60">Out-the-door price paid</p>
      </div>

      <div className="flex gap-3 mb-6">
        <Button variant="secondary" className="flex-1" href={`/buyer/deal/${dealId}/receipt`} data-testid="download-receipt-btn">
          <Download size={15} /> Receipt
        </Button>
        <Button variant="secondary" className="flex-1" href="/buyer/referral" data-testid="share-deal-btn">
          <Share2 size={15} /> Share & Earn
        </Button>
      </div>

      <TestimonialPromptClient dealId={dealId} />
    </div>
  );
}
