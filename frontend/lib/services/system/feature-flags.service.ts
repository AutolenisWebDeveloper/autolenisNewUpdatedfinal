// lib/services/system/feature-flags.service.ts
import { getFeatureFlag, setFeatureFlag } from "@/lib/services/admin/admin-platform.service";

export const FLAGS = {
  AI_CONCIERGE: "ai_concierge",
  REFINANCE_ENABLED: "refinance_enabled",
  TRADE_IN_ENABLED: "trade_in_enabled",
  INSURANCE_MOCK: "insurance_mock",
  SYSTEM_4C_ENABLED: "system_4c_enabled",
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
