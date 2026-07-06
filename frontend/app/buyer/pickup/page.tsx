import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vehicle Pickup", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { MapPin, QrCode, CheckCircle2 } from "lucide-react";
import PickupScheduleForm from "@/components/buyer/PickupScheduleForm";
import PickupRescheduleButton from "@/components/buyer/PickupRescheduleButton";

export const dynamic = "force-dynamic";

export default async function PickupPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { pickup: true, eSignEnvelope: true },
    orderBy: { createdAt: "desc" },
  });

  const pickup = deal?.pickup;
  const eSignCompleted = deal?.eSignEnvelope?.status === "COMPLETED";

  const now = new Date();
  const expiresAt = pickup?.qrExpiresAt ? new Date(pickup.qrExpiresAt) : null;
  const isExpired = expiresAt ? expiresAt < now : false;
  const isExpiringSoon = expiresAt && !isExpired
    ? (expiresAt.getTime() - now.getTime()) < 24 * 60 * 60 * 1000
    : false;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="pickup-page">
      <div className="flex items-center gap-3 mb-6">
        <MapPin size={24} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Vehicle Pickup</h1>
      </div>

      {!pickup ? (
        <div className="text-center py-12" data-testid="pickup-not-scheduled">
          {eSignCompleted ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-left" data-testid="pickup-schedule-container">
              <h2 className="font-semibold text-slate-800 mb-4">Schedule Your Pickup</h2>
              {deal && <PickupScheduleForm dealId={deal.id} />}
            </div>
          ) : (
            <p className="text-slate-500 text-sm mb-4">Pickup scheduling will be available once your contract is signed.</p>
          )}
        </div>
      ) : pickup.status === "COMPLETED" ? (
        <div className="text-center" data-testid="pickup-completed">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Pickup complete!</h2>
          <p className="text-slate-500 text-sm mb-6">Your vehicle has been picked up. Enjoy your new car!</p>
          <Button href={`/buyer/deal/${deal?.id}/complete`} data-testid="view-deal-complete-btn">View Deal Summary</Button>
        </div>
      ) : (
        <div>
          {pickup.scheduledAt && (
            <div className="bg-al-primary/5 border border-al-primary/20 rounded-xl p-5 mb-6" data-testid="pickup-scheduled">
              <p className="text-sm font-semibold text-slate-800">Scheduled pickup</p>
              <p className="text-lg font-bold text-al-primary mt-1">
                {pickup.scheduledAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
              {pickup.location && <p className="text-sm text-slate-500 mt-0.5">{pickup.location}</p>}
            </div>
          )}

          {/* QR code — generated via qrcode npm package (D7 — no external API) */}
          {pickup.qrCodeImage && (
            <div className="text-center bg-white border border-slate-200 rounded-xl p-8 mb-6" data-testid="pickup-qr-code">
              <QrCode size={32} className="text-al-primary mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-4">Present this QR code at the lot</p>
              <img src={pickup.qrCodeImage} alt="Pickup QR Code" className="mx-auto max-w-[200px]" />
              {expiresAt && (
                <p className={`text-xs font-medium mt-2 ${
                  isExpired      ? "text-red-600" :
                  isExpiringSoon ? "text-amber-600" :
                                   "text-[#10B981]"
                }`}>
                  {isExpired      && "⚠ QR code expired"}
                  {isExpiringSoon && `⚠ QR code expires soon: ${expiresAt.toLocaleString()}`}
                  {!isExpired && !isExpiringSoon && `✓ Valid until ${expiresAt.toLocaleDateString()}`}
                </p>
              )}
              {isExpired && (
                <a
                  href="/buyer/messages"
                  data-testid="qr-expired-contact-support"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-al-primary hover:text-al-primary-hover transition-colors"
                >
                  Message support to regenerate →
                </a>
              )}
            </div>
          )}

          {pickup.status === "SCHEDULED" && (
            <PickupRescheduleButton
              dealId={deal!.id}
              currentDate={pickup.scheduledAt?.toISOString() ?? ""}
              location={pickup.location ?? ""}
            />
          )}

          <p className="text-xs text-slate-400 text-center">Your pickup QR code is unique and single-use.</p>
        </div>
      )}
    </div>
  );
}
