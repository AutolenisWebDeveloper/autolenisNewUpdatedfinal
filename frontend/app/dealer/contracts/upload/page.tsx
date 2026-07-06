// Contract upload with pre-upload checklist (System 8 ENH)
import { requireDealer } from "@/lib/auth/dealer-session";
import ContractUploadButton from "@/components/dealer/ContractUploadButton";

const CHECKLIST_ITEMS = [
  "OTD total matches the vehicle price + tax + disclosed fees",
  "All add-on products are disclosed and itemized",
  "Documentation fee does not exceed $250",
  "APR rate matches the financing terms discussed",
  "No dealer reserve markup exceeding disclosed amount",
  "Warranty terms are clearly stated and accurate",
];

interface Props {
  searchParams: Promise<{ dealId?: string }>;
}

export default async function DealerContractUploadPage({ searchParams }: Props) {
  await requireDealer();
  const { dealId } = await searchParams;
  const resolvedDealId = dealId ?? "";

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="dealer-contract-upload-page">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Upload Contract</h1>
      <p className="text-sm text-slate-500 mb-6">
        Review this checklist before uploading. Contracts passing all items score higher with Contract Shield.
      </p>

      <div className="space-y-2 mb-6" data-testid="upload-checklist">
        {CHECKLIST_ITEMS.map((item, i) => (
          <div
            key={i}
            data-testid={`checklist-item-${i}`}
            className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-al-primary"
              data-testid={`checklist-check-${i}`}
            />
            <span className="text-sm text-slate-700">{item}</span>
          </div>
        ))}
      </div>

      <ContractUploadButton dealId={resolvedDealId} />
    </div>
  );
}
