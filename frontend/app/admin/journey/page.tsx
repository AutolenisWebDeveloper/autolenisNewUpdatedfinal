import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import JourneyControlClient from "./JourneyControlClient";

export const metadata: Metadata = { title: "Buyer Journey Control — Admin" };
export const dynamic = "force-dynamic";

export default async function BuyerJourneyControlPage() {
  await requireAdmin();
  return <JourneyControlClient />;
}
