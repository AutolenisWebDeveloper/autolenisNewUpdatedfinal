import { dispatch } from "@/lib/qstash/dispatch";
import {
  enqueueLifecycleTouch,
  cancelDepositReminderTouches,
  depositReminderBaseKey,
} from "@/lib/services/crm/lifecycle-touch-drain.service";

// ---------------------------------------------------------------------------
// $99 deposit-conversion reminder ENROLLMENT — single-authority selector.
//
// Two producers can drive the deposit-reminder sequence: the legacy QStash job
// (`/api/jobs/deposit-reminder`) and the internal Program-2 lifecycle scheduler
// (`lifecycle_touch_schedule`). They must NEVER both run — dual authority double-
// sends. This selector guarantees exactly one fires per enrollment:
//
//   DEPOSIT_REMINDER_INTERNAL_ENABLED !== "true"  → QStash  (DEFAULT / current authority)
//   DEPOSIT_REMINDER_INTERNAL_ENABLED === "true"  → internal lifecycle_touch
//
// The default preserves the current production authority (QStash). Cutover is a
// single owner-gated flag flip (mirrors the CRM_INAPP_ENGINE_ENABLED pattern),
// after the owner applies the lifecycle_touch_schedule SQL and retires the QStash
// producer — one authority at all times, never both. This function is invoked
// ONLY for the competitive path; concierge deposits are excluded by the caller
// (create-intent) so a concierge buyer never receives the generic reminder.
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;
// Legacy QStash first-touch delay (unchanged; the internal path carries the new
// +1h/+6h/+24h/+72h cadence and goes live at owner cutover).
const QSTASH_FIRST_TOUCH_DELAY_SECONDS = 86400;

export type DepositReminderAuthority = "internal" | "qstash";

export function depositReminderAuthority(): DepositReminderAuthority {
  return process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED === "true" ? "internal" : "qstash";
}

export interface EnrollDepositReminderInput {
  buyerId: string;
  firstName: string | null;
  email: string;
  phone?: string | null;
}

// Enroll a competitive unpaid buyer into the $99 deposit-conversion sequence.
// Idempotent per authority: the internal path is enqueue-once on
// UNIQUE(base_key, sequence); the QStash job self-stops once the deposit is PAID,
// so re-creating an intent is safe. The internal first touch is scheduled at
// +1 hour (the intentional grace — never chase a buyer mid-checkout).
export async function enrollDepositReminder(
  input: EnrollDepositReminderInput,
): Promise<{ authority: DepositReminderAuthority; enrolled: boolean }> {
  const authority = depositReminderAuthority();

  if (authority === "internal") {
    const { scheduled } = await enqueueLifecycleTouch({
      sequence: "deposit_reminder_1",
      entityId: input.buyerId,
      firstName: input.firstName,
      email: input.email,
      phone: input.phone ?? null,
      baseKey: depositReminderBaseKey(input.buyerId),
      runAt: new Date(Date.now() + ONE_HOUR_MS),
    });
    return { authority, enrolled: scheduled };
  }

  await dispatch({
    path: "/api/jobs/deposit-reminder",
    body: {
      buyerId: input.buyerId,
      firstName: input.firstName,
      email: input.email,
      touchNumber: 1,
    },
    delaySeconds: QSTASH_FIRST_TOUCH_DELAY_SECONDS,
  });
  return { authority, enrolled: true };
}

// Stop a buyer's remaining $99 deposit reminders (called on authoritative
// payment, and available for request cancel/expire). The internal path cancels
// its pending/sending rows; the QStash path has no cancel primitive but its job
// self-stops via the send-time guard (depositConversionResolved / hasPaidDeposit),
// which is authoritative regardless. Best-effort by construction.
export async function cancelDepositReminderEnrollment(
  buyerId: string,
  reason = "deposit_converted",
): Promise<void> {
  await cancelDepositReminderTouches(buyerId, { reason });
}
