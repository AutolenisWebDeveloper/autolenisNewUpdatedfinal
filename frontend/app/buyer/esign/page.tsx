import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign Documents", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PenLine, CheckCircle2 } from "lucide-react";
import ESignLaunchButton from "@/components/buyer/ESignLaunchButton";

export const dynamic = "force-dynamic";

export default async function ESignPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { eSignEnvelope: true },
    orderBy: { createdAt: "desc" },
  });

  const envelope = deal?.eSignEnvelope;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="esign-page">
      <div className="flex items-center gap-3 mb-6">
        <PenLine size={24} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Sign Your Documents</h1>
      </div>

      {!deal ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-xl" data-testid="esign-no-deal">
          <PenLine size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="font-medium text-slate-600 mb-1">Nothing to sign yet</p>
          <p className="text-sm text-slate-400 max-w-sm mx-auto px-6">
            Once you accept a dealer offer and your contract is prepared, your signing package will appear here.
          </p>
        </div>
      ) : !envelope ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center" data-testid="esign-pending">
          <p className="text-slate-600 text-sm">Your signing package is being prepared. You will receive an email when it&apos;s ready.</p>
        </div>
      ) : envelope.status === "COMPLETED" ? (
        <div className="text-center" data-testid="esign-completed">
          <CheckCircle2 size={40} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Documents signed</h2>
          <p className="text-slate-500 text-sm mb-6">All documents have been signed. You&apos;re almost at the finish line!</p>
          <Button href="/buyer/pickup" data-testid="goto-pickup-btn">Schedule Pickup</Button>
        </div>
      ) : (
        <div data-testid="esign-ready">
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <div className="flex-1">
              <p className="font-semibold text-slate-900 text-sm">Signing package ready</p>
              <Badge variant="amber" className="mt-1">{envelope.status.replace(/_/g, " ")}</Badge>
            </div>
          </div>
          <p className="text-sm text-slate-500 mb-6">
            Click below to open your DocuSign signing session. You can sign from any device.
          </p>
          <ESignLaunchButton
            dealId={deal.id}
            signingUrl={null}
          />
        </div>
      )}
    </div>
  );
}
