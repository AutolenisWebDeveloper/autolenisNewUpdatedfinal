// lib/services/system/feature-flags.service.ts
import { getFeatureFlag, setFeatureFlag } from "@/lib/services/admin/admin-platform.service";

export const FLAGS = {
  AI_CONCIERGE: "ai_concierge",
  REFINANCE_ENABLED: "refinance_enabled",
  TRADE_IN_ENABLED: "trade_in_enabled",
  INSURANCE_MOCK: "insurance_mock",
  SYSTEM_4C_ENABLED: "system_4c_enabled",
  // Batch 2 — hard-block dealer activation until agreement signed + license
  // verified. DEFAULT OFF (no FeatureFlag row → getFeatureFlag returns false).
  DEALER_ACTIVATION_GATE: "dealer_activation_gate",
} as const;

export async function isEnabled(flag: string): Promise<boolean> {
  return getFeatureFlag(flag);
}

export async function enable(flag: string, adminId: string) {
  return setFeatureFlag(flag, true, adminId);
}

export async function disable(flag: string, adminId: string) {
  return setFeatureFlag(flag, false, adminId);
}
