import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDealById } from "@/lib/services/dealer/dealer-deals.service";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Handshake } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ dealId: string }>;
}

// Ordered stages that map to the DealStatus enum values shown to dealers
const STAGES = [
  "ACTIVE",
  "CONTRACT_PENDING",
  "CONTRACT_REVIEW",
  "CONTRACT_APPROVED",
  "SIGNING_PENDING",
  "SIGNED",
  "PICKUP_SCHEDULED",
  "COMPLETED",
] as const;

const CHECKLIST_ITEMS = [
  "Title in hand",
  "Reconditioning complete",
  "Photos verified",
  "Sale documents prepared",
];

export default async function DealerDealDetailPage({ params }: Props) {
  const { dealId } = await params;
  const dealer = await requireDealer();

  const deal = await getDealerDealById(dealId, dealer.id);
  if (!deal) notFound();

  const currentStageIndex = STAGES.indexOf(deal.status as typeof STAGES[number]);
  const contactVisible = ["SIGNED", "PICKUP_SCHEDULED", "PICKUP_COMPLETE", "COMPLETED"].includes(deal.status);

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-deal-detail-page">
      <Link
        href="/dealer/deals"
        className="text-sm text-slate-400 hover:text-[#0B5FD1] transition-colors mb-6 flex items-center gap-1"
      >
        ← Back to Deals
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <Handshake size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Deal Progress</h1>
        <Badge variant="secondary" className="text-xs font-mono">
          #{deal.id.slice(0, 8)}
        </Badge>
      </div>

      {/* Stage Timeline */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="stage-timeline">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Deal Timeline
        </p>
        <div className="flex flex-wrap gap-y-3">
          {STAGES.map((stage, i) => {
            const isCompleted = i < currentStageIndex;
            const isCurrent = i === currentStageIndex;
            return (
              <div key={stage} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                      ${isCompleted ? "bg-green-500 text-white" : isCurrent ? "bg-[#0B5FD1] text-white" : "bg-slate-100 text-slate-400"}`}
                    data-testid={`stage-step-${stage}`}
                  >
                    {isCompleted ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-[9px] mt-1 text-center leading-tight max-w-[52px] ${
                      isCurrent
                        ? "text-[#0B5FD1] font-semibold"
                        : isCompleted
                        ? "text-green-600"
                        : "text-slate-400"
                    }`}
                  >
                    {stage.replace(/_/g, " ")}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div
                    className={`h-px w-4 mx-1 mt-[-10px] ${isCompleted ? "bg-green-400" : "bg-slate-200"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Delivery Prep Checklist */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="delivery-checklist">
        <p className="text-sm font-semibold text-slate-800 mb-3">Vehicle Delivery Prep Checklist</p>
        <div className="space-y-2">
          {CHECKLIST_ITEMS.map((item) => (
            <label key={item} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-[#0B5FD1]"
                data-testid={`checklist-${item.toLowerCase().replace(/\s+/g, "-")}`}
              />
              <span className="text-sm text-slate-700">{item}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Document Upload */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="document-upload-section">
        <p className="text-sm font-semibold text-slate-800 mb-3">Documents</p>
        <Button href="/dealer/contracts/upload" variant="secondary" className="text-sm">
          Upload Contract / Document
        </Button>
      </div>

      {/* Buyer Contact */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="buyer-contact-section">
        <p className="text-sm font-semibold text-slate-800 mb-2">Buyer Contact</p>
        {contactVisible ? (
          <p className="text-sm text-slate-600">Contact available upon scheduling.</p>
        ) : (
          <p className="text-sm text-slate-400">
            Contact information will be available once the deal progresses to signing.
          </p>
        )}
      </div>
    </div>
  );
}
