// lib/services/messaging/messaging.service.ts — System 20 / §25.2 anti-circumvention.
//
// §25.2: "Messages between buyer and dealership are monitored for CONTACT_ATTEMPT,
// EXTERNAL_DEAL, IDENTITY_MISMATCH, and PAYMENT_BYPASS patterns. A detection creates a record
// with the matched pattern and routes to Operations for review and resolution. ... Buyers are
// protected, not penalized, when the dealership initiates."
//
// WHAT WAS BROKEN, AND IT WAS NOT THE SCANNER. `checkAntiCircumvention` has always been
// symmetric — it reads `content` and knows nothing about who sent it. The asymmetry was in the
// CALL SITES: `sendMessage` had exactly one caller, `app/api/buyer/messages/route.ts:77`, so
// only the BUYER was scanned, redacted and flagged. Both dealer writers went straight to
// `prisma.message.create` with `isRedacted: false` hard-coded
// (`app/api/dealer/messages/route.ts:78`, `app/api/dealer/messages/threads/[threadId]/route.ts:62`),
// and there is no Prisma middleware that could have caught them — `lib/prisma.ts` is a bare
// `new PrismaClient` with no `$use` or `$extends`. So the bypass was total, and the party §25.2
// says should face consequences was the one party never examined.
//
// FOUR MORE DEFECTS ON THE PATH THAT DID SCAN, all fixed here:
//
//   1. IT DESTROYED ITS OWN EVIDENCE. The message content was overwritten with a fixed literal
//      and `redactReason` stored a CATEGORY ("Phone number detected") — never the matched
//      pattern, never the matched text. §25.2 requires "a record with the matched pattern", so
//      Operations was left reviewing a placeholder. The attempt row now carries the pattern and
//      the matched substring; the thread still shows the redaction to the other party.
//   2. NO ATTEMPT ROW WAS EVER WRITTEN. `recordCircumventionAttempt` had zero callers. The only
//      output was one `Notification` with `type: "SYSTEM_ALERT"`, no recipient ids, and
//      `.catch(() => {})` — an orphan row nobody is paged on.
//   3. NO §26 EXCEPTION. `CIRCUMVENTION_DETECTED` is in the catalogue
//      (`exception-catalogue.ts:620-631`) and was referenced nowhere.
//   4. IT WAS NOT TRANSACTIONAL, while the UNSCANNED buyer-support branch four lines away in
//      the same route WAS. A failure between the message insert and the thread flag left a
//      redacted message in an ACTIVE thread with no flag, no alert and no error surfaced — a
//      silently lost detection.
//
// THE SUPPORT-THREAD EXEMPTION IS PRESERVED EXACTLY. Buyer↔support threads are deliberately
// NOT redacted — a buyer must be able to give the team their phone number — and that branch
// lives in the buyer route, which checks for a DEALER participant before calling here. This
// service is only ever called for a thread that has one.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AntiCircumventionFlag, ThreadStatus, type Prisma } from "@prisma/client";
import { recordCircumventionAttempt } from "@/lib/services/trust/anti-circumvention.service";

type Db = typeof prisma | Prisma.TransactionClient;

const CIRCUMVENTION_PATTERNS = [
  { pattern: /\b(\d{3}[-.]?\d{3}[-.]?\d{4})\b/, flag: AntiCircumventionFlag.CONTACT_ATTEMPT, reason: "Phone number detected" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, flag: AntiCircumventionFlag.CONTACT_ATTEMPT, reason: "Email address detected" },
  { pattern: /\b(venmo|paypal|zelle|cashapp|wire transfer)\b/i, flag: AntiCircumventionFlag.PAYMENT_BYPASS, reason: "External payment method mentioned" },
  { pattern: /\b(direct deal|outside the platform|off platform|side deal)\b/i, flag: AntiCircumventionFlag.EXTERNAL_DEAL, reason: "Off-platform deal attempt" },
];

export interface CircumventionMatch {
  flagged: boolean;
  flag: AntiCircumventionFlag | null;
  /** The human-readable category, shown to the other party as the redaction reason. */
  reason: string | null;
  /**
   * The regular expression that matched, as source text. §25.2's "a record with the matched
   * pattern" — Operations cannot review a detection without knowing what triggered it.
   */
  pattern: string | null;
  /**
   * The substring that matched.
   *
   * PII BY CONSTRUCTION — it is frequently a phone number or an email address, which is the
   * whole point. It is written to `circumvention_attempts.pattern` alongside the expression and
   * is never returned to either party in the thread; the message content the other side sees
   * stays redacted. Operations needs it because "a phone number was detected" and "this specific
   * number was offered" are different findings, and only the second can be acted on.
   */
  matchedText: string | null;
}

/**
 * Scan one message body. PURE — no database, no side effects, symmetric by construction
 * because it takes content and nothing else.
 *
 * First match wins, in declaration order. `IDENTITY_MISMATCH` is in the enum
 * (`schema.prisma:2317`) and no pattern produces it; that is deliberate and recorded rather
 * than filled with a guess — an identity mismatch is a comparison between a stated identity and
 * a known one, not a text pattern, and inventing a regex for it would manufacture detections.
 */
export function checkAntiCircumvention(content: string): CircumventionMatch {
  for (const { pattern, flag, reason } of CIRCUMVENTION_PATTERNS) {
    const m = pattern.exec(content);
    if (m) {
      return { flagged: true, flag, reason, pattern: pattern.source, matchedText: m[0] };
    }
  }
  return { flagged: false, flag: null, reason: null, pattern: null, matchedText: null };
}

/** Who sent the message. §25.2's consequences apply only to a dealer-initiated attempt. */
export type SenderRole = "BUYER" | "DEALER" | "ADMIN" | "UNKNOWN";

/**
 * Resolve the sender's role from the thread's participants.
 *
 * NOT DERIVABLE FROM THE MESSAGE ROW, which is why this exists. `Message.senderId` is a bare
 * String with no relation (`schema.prisma:2574`) and `MessageThread` carries neither `buyerId`
 * nor `dealerId`, so the only record of who is who is `message_thread_participants.role`.
 * Without this lookup, symmetric scanning would produce attempt rows that still could not be
 * attributed to a dealership — which is 25-09a's actual requirement, not the scanning itself.
 */
export async function resolveSenderRole(
  threadId: string,
  senderId: string,
  db: Db = prisma,
): Promise<SenderRole> {
  const participant = await db.messageThreadParticipant.findFirst({
    where: { threadId, userId: senderId },
    select: { role: true },
  });
  const role = (participant?.role ?? "").toUpperCase();
  if (role === "BUYER" || role === "DEALER" || role === "ADMIN") return role;
  return "UNKNOWN";
}

export interface SendMessageResult {
  id: string;
  threadId: string;
  isRedacted: boolean;
  sentAt: Date;
}

/**
 * The ONE writer of a buyer↔dealer message, for BOTH directions.
 *
 * ATOMIC. The message insert, the thread timestamp and the FLAGGED transition commit together,
 * so there is no window in which a redacted message sits in an ACTIVE thread with no flag. The
 * attempt record and the §26 exception are written AFTER the commit, deliberately: they are
 * about a message that already exists, and holding the transaction open across a queue write
 * would make a queue outage fail the message.
 */
export async function sendMessage(
  threadId: string,
  senderId: string,
  content: string,
): Promise<SendMessageResult> {
  const match = checkAntiCircumvention(content);
  const senderRole = await resolveSenderRole(threadId, senderId);

  const { message } = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        threadId,
        senderId,
        // The redaction the OTHER party sees. Symmetric: a dealer who posts a phone number has
        // it redacted exactly as a buyer does. What differs is the consequence, not the
        // redaction — §25.2 protects buyers from PENALTY, not from redaction, and redacting one
        // side only would leak the very contact detail the firewall exists to withhold.
        content: match.flagged ? "[Message redacted — possible policy violation]" : content,
        isRedacted: match.flagged,
        redactReason: match.reason,
        antiCircumventionFlag: match.flag,
      },
      select: { id: true, sentAt: true },
    });

    await tx.messageThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: new Date(),
        ...(match.flagged
          ? { status: ThreadStatus.FLAGGED, flaggedAt: new Date(), flagReason: match.reason }
          : {}),
      },
    });

    return { message: created };
  });

  if (match.flagged && match.flag) {
    // Outside the transaction, and never allowed to fail the send. A message that was
    // successfully redacted and flagged is already the safe outcome; losing the queue row is bad
    // and is logged loudly, but throwing here would mean the sender's message is rejected
    // because Operations' queue was briefly unavailable.
    await recordCircumventionAttempt({
      threadId,
      messageId: message.id,
      userId: senderId,
      initiatorRole: senderRole,
      flag: match.flag,
      pattern: match.pattern ?? match.reason ?? "unknown",
      matchedText: match.matchedText,
    }).catch((err) => {
      logger.error(
        `[messaging] DETECTION NOT RECORDED for message ${message.id} in thread ${threadId} ` +
          `(flag ${match.flag}, sender role ${senderRole}):`,
        err,
      );
    });
  }

  return {
    id: message.id,
    threadId,
    isRedacted: match.flagged,
    sentAt: message.sentAt,
  };
}

/**
 * Find or create the thread for a deal.
 *
 * SCOPED BY DEAL ONLY, which is the fix for a duplicate-thread defect the review surfaced:
 * `app/api/dealer/messages/route.ts:19-21` scoped its own `findFirst` by deal AND participant,
 * so a thread that already existed for the deal without that dealer as a participant produced a
 * SECOND thread for the same deal. `MessageThread.dealId` has no unique constraint, so nothing
 * stopped it — and two live threads on one deal mean a circumvention scan and any FLAGGED state
 * apply to only one of them, while `/admin/messages` shows them as unrelated rows.
 *
 * One thread per deal, and a participant who is missing is ADDED rather than being a reason to
 * fork.
 */
export async function getOrCreateThread(
  dealId: string,
  participants: Array<{ userId: string; role: string }>,
) {
  const existing = await prisma.messageThread.findFirst({ where: { dealId } });
  if (existing) {
    // Add any participant not already on the thread. `createMany` with `skipDuplicates` needs a
    // unique constraint to skip against, so the membership is read first.
    const present = new Set(
      (
        await prisma.messageThreadParticipant.findMany({
          where: { threadId: existing.id },
          select: { userId: true },
        })
      ).map((p) => p.userId),
    );
    const missing = participants.filter((p) => !present.has(p.userId));
    if (missing.length > 0) {
      await prisma.messageThreadParticipant.createMany({
        data: missing.map((p) => ({ threadId: existing.id, userId: p.userId, role: p.role })),
      });
    }
    return existing;
  }

  const thread = await prisma.messageThread.create({ data: { dealId } });
  await prisma.messageThreadParticipant.createMany({
    data: participants.map((p) => ({ threadId: thread.id, userId: p.userId, role: p.role })),
  });
  return thread;
}
