// lib/services/messaging/messaging.service.ts — System 20 anti-circumvention

import { prisma } from "@/lib/prisma";
import { AntiCircumventionFlag, ThreadStatus } from "@prisma/client";

const CIRCUMVENTION_PATTERNS = [
  { pattern: /\b(\d{3}[-.]?\d{3}[-.]?\d{4})\b/, flag: AntiCircumventionFlag.CONTACT_ATTEMPT, reason: "Phone number detected" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, flag: AntiCircumventionFlag.CONTACT_ATTEMPT, reason: "Email address detected" },
  { pattern: /\b(venmo|paypal|zelle|cashapp|wire transfer)\b/i, flag: AntiCircumventionFlag.PAYMENT_BYPASS, reason: "External payment method mentioned" },
  { pattern: /\b(direct deal|outside the platform|off platform|side deal)\b/i, flag: AntiCircumventionFlag.EXTERNAL_DEAL, reason: "Off-platform deal attempt" },
];

export function checkAntiCircumvention(content: string): { flagged: boolean; flag: AntiCircumventionFlag | null; reason: string | null } {
  for (const { pattern, flag, reason } of CIRCUMVENTION_PATTERNS) {
    if (pattern.test(content)) {
      return { flagged: true, flag, reason };
    }
  }
  return { flagged: false, flag: null, reason: null };
}

export async function sendMessage(threadId: string, senderId: string, content: string) {
  const { flagged, flag, reason } = checkAntiCircumvention(content);

  const message = await prisma.message.create({
    data: {
      threadId,
      senderId,
      content: flagged ? "[Message redacted — possible policy violation]" : content,
      isRedacted: flagged,
      redactReason: reason,
      antiCircumventionFlag: flag,
    },
  });

  // Update thread last message timestamp
  await prisma.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });

  // Flag thread if circumvention detected
  if (flagged) {
    await prisma.messageThread.update({ where: { id: threadId }, data: { status: ThreadStatus.FLAGGED, flaggedAt: new Date(), flagReason: reason } });
    await prisma.notification.create({
      data: { title: "Message flagged for review", body: `Thread ${threadId.slice(-8)} flagged: ${reason}`, type: "SYSTEM_ALERT" },
    }).catch(() => {});
  }

  return message;
}

export async function getOrCreateThread(dealId: string, participants: Array<{ userId: string; role: string }>) {
  const existing = await prisma.messageThread.findFirst({ where: { dealId } });
  if (existing) return existing;

  const thread = await prisma.messageThread.create({ data: { dealId } });
  await prisma.messageThreadParticipant.createMany({
    data: participants.map(p => ({ threadId: thread.id, userId: p.userId, role: p.role })),
  });
  return thread;
}
