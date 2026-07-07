import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import VehicleRequestDetailClient, { type RequestMeta } from "./VehicleRequestDetailClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vehicle Request Detail" };

interface Props { params: Promise<{ id: string }> }

export default async function VehicleRequestDetailPage({ params }: Props) {
  const { id } = await params;
  await requireAdmin();

  // Canonical pipeline: VehicleRequest ids resolve to the full command view at
  // /admin/requests/[id] (the list at /admin/vehicle-requests links there too).
  // Only legacy Notification-based requests fall through to the client below.
  const canonical = await prisma.vehicleRequest.findUnique({ where: { id }, select: { id: true } });
  if (canonical) redirect(`/admin/requests/${id}`);

  const req = await prisma.notification.findUnique({ where: { id } });
  if (!req || !req.title?.startsWith("Vehicle Request:")) notFound();

  const meta = (req.metadata ?? {}) as RequestMeta;

  return (
    <VehicleRequestDetailClient
      requestId={req.id}
      submittedAt={req.createdAt.toISOString()}
      meta={meta}
    />
  );
}
