import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import VehicleRequestDetailClient, { type RequestMeta } from "./VehicleRequestDetailClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vehicle Request Detail" };

interface Props { params: Promise<{ id: string }> }

export default async function VehicleRequestDetailPage({ params }: Props) {
  const { id } = await params;
  await requireAdmin();

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
