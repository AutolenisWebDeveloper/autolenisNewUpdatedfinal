import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { MapPin } from "lucide-react";
import { AdminPickupActions } from "@/components/admin/AdminPickupActions";

interface Props { params: Promise<{ dealId: string }> }
export const dynamic = "force-dynamic";

export default async function AdminDealPickupPage({ params }: Props) {
  const { dealId } = await params;
  await requireAdmin();
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: true, pickup: true },
  });
  if (!deal) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-deal-pickup-page">
      <div className="flex items-center gap-3 mb-4"><MapPin size={20} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Pickup — Deal #{dealId.slice(-8)}</h1></div>
      <p className="text-sm text-slate-500 mb-6">Buyer: {deal.buyer.firstName} {deal.buyer.lastName}</p>
      {deal.pickup ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3" data-testid="deal-pickup-details">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-800">Pickup Status</p>
            <Badge variant={deal.pickup.status === "COMPLETED" ? "green" : "amber"}>{deal.pickup.status.replace(/_/g, " ")}</Badge>
          </div>
          {deal.pickup.scheduledAt && <p className="text-sm text-slate-500">Scheduled: {deal.pickup.scheduledAt.toLocaleDateString()}</p>}
          {deal.pickup.location && <p className="text-sm text-slate-500">Location: {deal.pickup.location}</p>}
          <AdminPickupActions
            dealId={dealId}
            pickupStatus={deal.pickup.status}
            scheduledAt={deal.pickup.scheduledAt?.toISOString() ?? null}
            location={deal.pickup.location}
          />
        </div>
      ) : (
        <div className="text-center py-10 bg-white border border-slate-200 rounded-xl text-slate-400" data-testid="no-pickup">
          <p>No pickup scheduled yet.</p>
          <AdminPickupActions dealId={dealId} pickupStatus={null} scheduledAt={null} location={null} />
        </div>
      )}
    </div>
  );
}
