// lib/services/ai/ai-moderation.service.ts
import { isAiEnabled } from "@/lib/ai/kill-switch";

export function moderateInput(text: string): { safe: boolean; reason?: string } {
  const blockedPatterns = [/ssn\s*:\s*\d{3}-?\d{2}-?\d{4}/i, /credit card\s*:\s*\d{4}/i];
  for (const pattern of blockedPatterns) {
    if (pattern.test(text)) return { safe: false, reason: "Sensitive data detected in input" };
  }
  return { safe: true };
}

export function logAiKillSwitchEvent(enabled: boolean, reason?: string, adminId?: string) {
  // In production: log to AiKillSwitchLog table
  console.log(`[AI Kill Switch] ${enabled ? "ENABLED" : "DISABLED"} by ${adminId ?? "system"}. Reason: ${reason ?? "none"}`);
}
