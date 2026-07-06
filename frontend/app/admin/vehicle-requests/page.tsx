// /admin/vehicle-requests — public buyer submissions from /request-vehicle.
// Queries the canonical VehicleRequest model directly (the prior implementation
// read stale Notification rows), so status reflects the real lifecycle enum.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, PlusCircle } from "lucide-react";
import VehicleRequestsListClient, {
  type VehicleRequestRow,
} from "./VehicleRequestsListClient";

export const dynamic = "force-dynamic";

export default async function AdminVehicleRequestsPage() {
  await requireAdmin();

  const requests = await prisma.vehicleRequest.findMany({
    where: {
      status: {
        notIn: ["CANCELLED", "EXPIRED"],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      buyer: {
        include: {
          user: { select: { email: true } },
        },
      },
      financing: {
        select: {
          paymentMethod: true,
          preApprovalStatus: true,
        },
      },
      _count: {
        select: { offers: true },
      },
    },
    take: 100,
  });

  const rows: VehicleRequestRow[] = requests.map((req) => ({
    id: req.id,
    status: req.status,
    buyerName: `${req.buyer?.firstName ?? ""} ${req.buyer?.lastName ?? ""}`.trim(),
    email: req.buyer?.user?.email ?? null,
    paymentMethod: req.financing?.paymentMethod ?? null,
    preApprovalStatus: req.financing?.preApprovalStatus ?? null,
    make: req.makePreference ?? "Any make",
    model: req.modelPreference ?? "Any model",
    maxBudgetCents: req.maxBudgetCents,
    createdAt: req.createdAt.toISOString(),
    offerCount: req._count.offers,
  }));

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-vehicle-requests-page">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Public Vehicle Requests</h1>
        <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
        <Link
          href="/admin/vehicle-offers/new"
          data-testid="create-offer-from-requests-btn"
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-al-primary hover:bg-[#0944a8] text-white rounded-lg text-xs font-semibold transition-colors"
        >
          <PlusCircle size={13} /> Create Offer Link
        </Link>
      </div>

      <VehicleRequestsListClient requests={rows} />
    </div>
  );
}
