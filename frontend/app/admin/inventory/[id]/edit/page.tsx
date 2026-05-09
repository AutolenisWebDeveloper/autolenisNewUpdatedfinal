import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import EditInventoryClient from "./EditInventoryClient";

export const dynamic = "force-dynamic";

export default async function AdminInventoryEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) notFound();

  const initial = {
    id: item.id,
    make: item.make,
    model: item.model,
    year: item.year,
    trim: item.trim ?? "",
    vin: item.vin ?? "",
    priceCents: item.priceCents,
    mileage: item.mileage ?? null,
    condition: item.condition ?? "used",
    bodyType: item.bodyType ?? "",
    exteriorColor: item.exteriorColor ?? "",
    interiorColor: item.interiorColor ?? "",
    engine: item.engine ?? "",
    transmission: item.transmission ?? "",
    drivetrain: item.drivetrain ?? "",
    fuelType: item.fuelType ?? "",
    city: item.city ?? "",
    state: item.state ?? "",
    zip: item.zip ?? "",
    description: item.description ?? "",
    lane: item.lane,
    isActive: item.isActive,
    images: item.images,
  };

  return <EditInventoryClient initial={initial} />;
}
