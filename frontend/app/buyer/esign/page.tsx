import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign Documents", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PenLine } from "lucide-react";
import SigningCeremony from "@/components/buyer/SigningCeremony";

export const dynamic = "force-dynamic";

export default async function ESignPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { eSignEnvelope: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="esign-page">
      <div className="flex items-center gap-3 mb-6">
        <PenLine size={24} className="text-al-primary" aria-hidden="true" />
        <h1 className="text-xl font-bold text-slate-900">Sign Your Contract</h1>
      </div>

      {!deal ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-xl" data-testid="esign-no-deal">
          <PenLine size={32} className="text-slate-200 mx-auto mb-3" aria-hidden="true" />
          <p className="font-medium text-slate-600 mb-1">Nothing to sign yet</p>
          <p className="text-sm text-slate-400 max-w-sm mx-auto px-6">
            Once you accept a dealer offer and your contract passes Contract Shield review, your signing package will appear here.
          </p>
        </div>
      ) : (
        <SigningCeremony dealId={deal.id} />
      )}
    </div>
  );
}
