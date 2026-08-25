import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { buyerFacingDealerName } from "@/lib/services/offer/dealer-display";
import { notFound } from "next/navigation";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";
import ReceiptActions from "@/components/buyer/ReceiptActions";

interface Props { params: Promise<{ dealId: string }> }

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: Props) {
  const { dealId } = await params;
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id, status: "COMPLETED" },
    include: {
      offer: {
        include: {
          dealer: { select: { dealershipName: true, city: true, state: true, isSystemPlaceholder: true } },
        },
      },
      vehicleRequestOffer: { select: { priceCents: true, vehicleInfo: true, notes: true } },
    },
  });
  if (!deal) notFound();

  const otdPriceCents = deal.offer?.otdPriceCents ?? deal.vehicleRequestOffer?.priceCents ?? 0;
  const dealerName = buyerFacingDealerName(deal.offer);
  // Placeholder/concierge offers carry no real dealer city/state → suppress the line.
  const isPlaceholderDealer = deal.offer?.dealer?.isSystemPlaceholder === true;
  const dealerCity = isPlaceholderDealer ? null : (deal.offer?.dealer?.city ?? null);
  const dealerState = isPlaceholderDealer ? null : (deal.offer?.dealer?.state ?? null);
  const isPremium = buyer.plan === "PREMIUM";

  return (
    <div className="p-6 md:p-8 max-w-2xl print:p-0" data-testid="receipt-page">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b border-[#E5E7EB]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-al-primary mb-1">
              AutoLenis
            </p>
            <h1 className="text-2xl font-bold text-[#111827]">Deal Receipt</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              {new Date(deal.updatedAt).toLocaleDateString("en-US", {
                year: "numeric", month: "long", day: "numeric",
              })}
            </p>
          </div>
          <p className="text-xs text-[#94A3B8] font-mono">{dealId.slice(0, 8).toUpperCase()}</p>
        </div>

        {/* Dealer */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8] mb-3">
            Dealer
          </p>
          <p className="font-bold text-[#111827] text-lg">
            {dealerName}
          </p>
          {dealerCity && dealerState && (
            <p className="text-sm text-[#4B5563] mt-1">
              {dealerCity}, {dealerState}
            </p>
          )}
        </div>

        {/* Financials */}
        <div className="bg-[#F8F9FB] rounded-xl p-5 mb-6 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-[#4B5563]">Out-the-Door Price</span>
            <span className="font-bold text-[#111827]">
              ${(otdPriceCents / 100).toLocaleString()}
            </span>
          </div>
          {isPremium && (
            <div className="flex justify-between text-sm">
              <span className="text-[#4B5563]">AutoLenis Service Fee</span>
              <span className="text-[#111827]">
                ${(PREMIUM_FEE_CENTS / 100).toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-[#4B5563]">Auction Access Deposit (credited)</span>
            <span className="text-[#059669]">
              −${(DEPOSIT_AMOUNT_CENTS / 100).toFixed(2)}
            </span>
          </div>
          <div className="pt-3 border-t border-[#E5E7EB] flex justify-between">
            <span className="font-bold text-[#111827]">Total via AutoLenis</span>
            <span className="font-bold text-al-primary text-lg">
              ${((otdPriceCents + (isPremium ? PREMIUM_FEE_CENTS : 0)
                - DEPOSIT_AMOUNT_CENTS) / 100).toLocaleString()}
            </span>
          </div>
        </div>

        <ReceiptActions dealId={dealId} />
      </div>
    </div>
  );
}
