// lib/services/ai/ai-kill-switch.service.ts
//
// The runtime (soft) tier of the AI kill switch — the admin-controlled half.
//
// `AiKillSwitchLog` has existed since the schema was written and has never held
// a row, for the simple reason that there has never been a toggle. This service
// is that toggle, and every flip writes exactly one flag row and one log row in
// one transaction, so the two can never disagree about what happened.
//
// Vocabulary, stated once because it is easy to invert:
//   `killed === true`  → the kill switch is ENGAGED; AI is disabled.
//   `killed === false` → the kill switch is RELEASED; AI runs.
// Both the `ai_kill_switch` FeatureFlag row and `AiKillSwitchLog.enabled` hold
// that same value — "is the kill switch on".

import { prisma } from "@/lib/prisma";
import { AI_KILL_SWITCH_FLAG, invalidateKillSwitchCache } from "@/lib/ai/kill-switch";

/** Admin roles permitted to operate the runtime kill switch. */
export const KILL_SWITCH_ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS_ADMIN"] as const;

export type KillSwitchAdminRole = (typeof KILL_SWITCH_ADMIN_ROLES)[number];

export function canOperateKillSwitch(role: string): boolean {
  return (KILL_SWITCH_ADMIN_ROLES as readonly string[]).includes(role);
}

export interface KillSwitchState {
  /** Is the runtime kill switch engaged? */
  killed: boolean;
  /** Is the deploy-level env stop engaged? Independent of, and stronger than, `killed`. */
  envKilled: boolean;
  /** The resolved answer both tiers produce together. */
  aiEnabled: boolean;
}

export async function getAiKillSwitchState(): Promise<KillSwitchState> {
  const flag = await prisma.featureFlag.findUnique({ where: { key: AI_KILL_SWITCH_FLAG } });
  const killed = flag?.enabled ?? false;
  const envKilled = process.env.AI_KILL_SWITCH === "true";
  return { killed, envKilled, aiEnabled: !envKilled && !killed };
}

/**
 * Flip the runtime kill switch. Writes the FeatureFlag row and the
 * `AiKillSwitchLog` audit row in ONE transaction: a flip that changed
 * behaviour but left no record, or a record of a flip that did not happen,
 * are both worse than a failed toggle the operator can retry.
 */
export async function setAiKillSwitch(params: {
  killed: boolean;
  adminId: string;
  reason?: string;
}): Promise<KillSwitchState> {
  const { killed, adminId, reason } = params;

  await prisma.$transaction([
    prisma.featureFlag.upsert({
      where: { key: AI_KILL_SWITCH_FLAG },
      create: {
        key: AI_KILL_SWITCH_FLAG,
        enabled: killed,
        description:
          "AI kill switch (runtime tier). true = all AI operations disabled. " +
          "Absent row = not killed, which preserves the pre-flag default.",
        updatedBy: adminId,
      },
      update: { enabled: killed, updatedBy: adminId },
    }),
    prisma.aiKillSwitchLog.create({
      data: { enabled: killed, adminId, reason: reason ?? null },
    }),
  ]);

  // Drop this instance's memoised flag read so the operator sees the flip take
  // effect immediately here. Other serverless instances converge within the
  // cache window; the transaction above is what makes the change durable.
  invalidateKillSwitchCache();

  return getAiKillSwitchState();
}
