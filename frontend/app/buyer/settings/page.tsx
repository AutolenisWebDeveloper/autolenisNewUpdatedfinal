import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

// Fully functional buyer settings — notification prefs, security, support, danger zone.
// Placeholder removed.

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const buyer = await requireBuyer();
  const existing = await prisma.buyerPreferences.findUnique({ where: { buyerId: buyer.id } });

  const initial = {
    emailNotifications: existing?.emailNotifications ?? true,
    marketingEmails: existing?.marketingEmails ?? false,
    auctionAlerts: existing?.auctionAlerts ?? true,
    dealUpdates: existing?.dealUpdates ?? true,
  };

  return <SettingsClient initial={initial} email={buyer.user.email} />;
}
