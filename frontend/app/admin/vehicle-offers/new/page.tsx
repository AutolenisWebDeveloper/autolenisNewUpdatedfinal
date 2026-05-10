import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import VehicleOfferCreateClient from "./VehicleOfferCreateClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create Vehicle Offer Link" };

export default async function VehicleOfferNewPage() {
  await requireAdmin();
  return <VehicleOfferCreateClient />;
}
