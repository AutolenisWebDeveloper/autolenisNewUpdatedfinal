// lib/services/notifications/notification-preference.service.ts
import { prisma } from "@/lib/prisma";

export async function getPreferences(userId: string) {
  return prisma.notificationPreference.findUnique({ where: { userId } });
}

export async function setPreferences(userId: string, prefs: { emailEnabled?: boolean; inAppEnabled?: boolean; auctionUpdates?: boolean; dealUpdates?: boolean }) {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...prefs },
    update: prefs,
  });
}

export async function shouldSendEmail(userId: string, notificationType: string): Promise<boolean> {
  const pref = await getPreferences(userId);
  if (!pref) return true; // Default: send all
  if (!pref.emailEnabled) return false;
  if (notificationType.includes("AUCTION") && !pref.auctionUpdates) return false;
  if (notificationType.includes("DEAL") && !pref.dealUpdates) return false;
  return true;
}
