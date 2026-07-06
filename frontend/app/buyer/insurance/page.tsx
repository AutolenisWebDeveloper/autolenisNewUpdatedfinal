import type { Metadata } from "next";

export const metadata: Metadata = { title: "Insurance" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, Clock, Upload, FileText } from "lucide-react";
import InsuranceQuoteForm from "@/components/buyer/InsuranceQuoteForm";
import InsuranceUploadButton from "@/components/buyer/InsuranceUploadButton";
import type { InventoryItem } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function BuyerInsurancePage() {
  const buyer = await requireBuyer();

  // Fetch the most recent deal with the offer (for otdPriceCents)
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    include: {
      offer: {
        select: { otdPriceCents: true },
      },
    },
  });

  // Vehicle resolution:
  // TODO: The Offer→Auction chain in schema.prisma has no direct relation to
  // InventoryItem, so we cannot deterministically resolve the vehicle that the
  // deal/auction is actually for. The correct long-term fix is to add an
  // `inventoryItemId` FK on Offer (or Auction) referencing InventoryItem and
  // use that here. Until then, we fall back to the buyer's MOST RECENTLY
  // shortlisted item (orderBy addedAt desc) as the best heuristic — this is
  // far more likely to be the vehicle they won the auction on than the
  // first-ever shortlisted item.
  let vehicle: Pick<
    InventoryItem,
    "year" | "make" | "model" | "trim" | "vin" | "exteriorColor" | "mileage" | "priceCents"
  > | null = null;
  let vehicleInventoryItemId: string | null = null;

  if (deal) {
    const shortlist = await prisma.shortlist.findUnique({
      where: { buyerId: buyer.id },
      include: { items: { take: 1, orderBy: { addedAt: "desc" } } },
    });
    const recentItemId = shortlist?.items[0]?.inventoryItemId ?? null;
    if (recentItemId) {
      vehicleInventoryItemId = recentItemId;
      vehicle = await prisma.inventoryItem.findUnique({
        where: { id: recentItemId },
        select: {
          year: true,
          make: true,
          model: true,
          trim: true,
          vin: true,
          exteriorColor: true,
          mileage: true,
          priceCents: true,
        },
      });
    }
  }

  const otdPriceCents = deal?.offer?.otdPriceCents ?? null;
  const insuranceStatus = deal?.insuranceStatus ?? "NOT_STARTED";

  const isVerified      = insuranceStatus === "VERIFIED";
  const isPolicyBound   = insuranceStatus === "POLICY_BOUND";
  const quoteRequested  = ["QUOTE_REQUESTED", "QUOTE_RECEIVED", "POLICY_SELECTED"].includes(insuranceStatus);
  const proofUploaded   = insuranceStatus === "EXTERNAL_UPLOADED" || isVerified;

  const statusBadgeVariant = isVerified || isPolicyBound ? "green" : "secondary";

  const statusConfig: Record<string, { label: string; icon: React.ReactNode }> = {
    NOT_STARTED:       { label: "Not Started",       icon: <Clock size={14} className="text-[#6B7280]" /> },
    QUOTE_REQUESTED:   { label: "Quote Requested",   icon: <Clock size={14} className="text-[#F59E0B]" /> },
    QUOTE_RECEIVED:    { label: "Quote Received",    icon: <FileText size={14} className="text-al-primary" /> },
    POLICY_SELECTED:   { label: "Policy Selected",   icon: <FileText size={14} className="text-al-primary" /> },
    POLICY_BOUND:      { label: "Policy Bound",      icon: <CheckCircle2 size={14} className="text-[#10B981]" /> },
    EXTERNAL_UPLOADED: { label: "Proof Uploaded",    icon: <Clock size={14} className="text-[#F59E0B]" /> },
    VERIFIED:          { label: "Verified",          icon: <CheckCircle2 size={14} className="text-[#10B981]" /> },
    FAILED:            { label: "Failed",            icon: <Clock size={14} className="text-red-500" /> },
  };

  const current = statusConfig[insuranceStatus] ?? statusConfig.NOT_STARTED;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="buyer-insurance-page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-[#111827]">Insurance</h1>
      </div>

      {/* Status badge */}
      {deal && (
        <div className="flex items-center gap-2 mb-6" data-testid="insurance-status-row">
          <span className="text-sm text-[#6B7280]">Current status:</span>
          <Badge variant={statusBadgeVariant} className="flex items-center gap-1.5">
            {current.icon}
            {current.label}
          </Badge>
        </div>
      )}

      {isVerified || isPolicyBound ? (
        <div className="flex items-center gap-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-5 mb-6" data-testid="insurance-complete-banner">
          <CheckCircle2 size={20} className="text-[#10B981] shrink-0" />
          <p className="text-sm font-medium text-[#065F46]">
            Your insurance is verified. No further action needed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 mb-6">
          {/* OPTION 1: Request a Quote */}
          <div className="bg-white border-2 border-al-primary/20 rounded-xl p-5" data-testid="insurance-quote-section">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-al-primary-subtle flex items-center justify-center shrink-0">
                <FileText size={16} className="text-al-primary" />
              </div>
              <div>
                <p className="font-semibold text-[#111827] text-sm">
                  Request a quote through AutoLenis
                </p>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  Fill in a few details and our team will respond within 1 business day.
                </p>
              </div>
            </div>
            {quoteRequested ? (
              <div className="flex items-center gap-2 mt-3 text-sm text-[#F59E0B]">
                <Clock size={14} />
                <span className="font-medium">Quote request submitted — pending review</span>
              </div>
            ) : (
              deal && (
                <InsuranceQuoteForm
                  dealId={deal.id}
                  inventoryItemId={vehicle ? vehicleInventoryItemId : null}
                  vehicle={vehicle ? {
                    year:          vehicle.year,
                    make:          vehicle.make,
                    model:         vehicle.model,
                    trim:          vehicle.trim ?? null,
                    vin:           vehicle.vin ?? null,
                    exteriorColor: vehicle.exteriorColor ?? null,
                    mileage:       vehicle.mileage ?? null,
                    otdPriceCents: otdPriceCents,
                  } : null}
                />
              )
            )}
            {!deal && (
              <p className="text-xs text-[#9CA3AF]">Complete a deal to unlock this option.</p>
            )}
          </div>

          {/* OPTION 2: Upload Proof */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5" data-testid="insurance-upload-section">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[#F8F9FB] flex items-center justify-center shrink-0">
                <Upload size={16} className="text-[#4B5563]" />
              </div>
              <div>
                <p className="font-semibold text-[#111827] text-sm">
                  I already have coverage
                </p>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  Upload your current declarations page or proof of insurance.
                  Accepted: PDF, JPG, PNG · Max 10 MB.
                </p>
              </div>
            </div>
            {proofUploaded ? (
              <p className="text-sm font-medium text-[#F59E0B]">
                ✓ Proof submitted — under review
              </p>
            ) : deal ? (
              <InsuranceUploadButton dealId={deal.id} />
            ) : (
              <p className="text-xs text-[#9CA3AF]">Complete a deal to unlock this option.</p>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-[#9CA3AF] bg-[#F8F9FB] rounded-lg p-3 leading-relaxed">
        Insurance verification is required before contract signing and vehicle pickup.
        It is not required to activate your auction.
      </p>
    </div>
  );
}
