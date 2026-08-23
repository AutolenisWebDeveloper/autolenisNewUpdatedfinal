import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CheckCircle2, ExternalLink, Upload } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offer Submitted — AutoLenis", robots: { index: false, follow: false } };

interface Props { params: Promise<{ token: string }> }

type SubmittedVehicle = {
  vehicleUrl: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  offerPriceCents: number;
};

export default async function DealerOfferConfirmedPage({ params }: Props) {
  const { token } = await params;
  const offer = await prisma.vehicleOffer.findUnique({
    where: { token },
    include: { submissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });
  if (!offer) notFound();

  const submission = offer.submissions[0];
  const vehicles: SubmittedVehicle[] = Array.isArray(submission?.vehicles)
    ? (submission.vehicles as unknown as SubmittedVehicle[])
    : [];

  return (
    <main className="min-h-screen bg-[#F8F9FB] flex items-center justify-center p-4">
      <div
        className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-10 max-w-lg w-full text-center"
        data-testid="dealer-offer-confirmed"
      >
        <div className="w-16 h-16 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 size={28} className="text-[#059669]" />
        </div>
        <h2 className="font-bold text-[#111827] text-2xl mb-2">Offer Submitted!</h2>
        <p className="text-[#4B5563] mb-6">
          Thank you{submission ? `, ${submission.dealershipName}` : ""}. We received your offer{vehicles.length === 1 ? "" : "s"} and will be in touch shortly.
        </p>

        {vehicles.length > 0 && (
          <div className="space-y-3 mb-6 text-left">
            {vehicles.map((v, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="font-semibold text-sm text-[#111827]">
                  Offer {i + 1}: {v.year} {v.make} {v.model} — ${(v.offerPriceCents / 100).toLocaleString()} OTD
                </p>
                <a
                  href={v.vehicleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[#0B5FD1] text-xs font-medium mt-1.5 hover:underline"
                >
                  <ExternalLink size={12} /> View Vehicle Listing →
                </a>
              </div>
            ))}
          </div>
        )}

        {Array.isArray(submission?.documents) &&
          (submission.documents as Array<{ name: string; url: string }>).length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-4 mb-6 text-left">
              <p className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3">
                Documents Submitted ({(submission.documents as Array<{ name: string }>).length})
              </p>
              <div className="space-y-1.5">
                {(submission.documents as Array<{ name: string; url: string }>).map((doc, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-[#0B5FD1]">
                    <Upload size={12} />
                    <span className="truncate">{doc.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        <p className="text-xs text-slate-400 mb-6">
          AutoLenis will review your offers and contact you within 24 hours.
        </p>

        <div className="flex gap-3 justify-center">
          <a
            href={`/dealer-offer/${token}`}
            data-testid="submit-another-link"
            className="inline-flex items-center gap-2 border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Submit Another Offer
          </a>
          <a
            href="/"
            data-testid="confirmed-home-link"
            className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#0944a8]"
          >
            Back to AutoLenis
          </a>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-6 text-left">
          <p className="text-xs text-amber-700 leading-relaxed">
            <strong>Reminder:</strong> By submitting this offer, your dealership has agreed to pay AutoLenis a referral fee upon successful completion of a sale. Fee terms will be confirmed in writing before deal finalization.
          </p>
        </div>
      </div>
    </main>
  );
}
