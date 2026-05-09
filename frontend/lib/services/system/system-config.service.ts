// lib/services/system/system-config.service.ts
import { getSystemConfig, setSystemConfig, getAllConfigs } from "@/lib/services/admin/admin-platform.service";
export { getSystemConfig, setSystemConfig, getAllConfigs };

// Platform-level defaults
export const CONFIG_KEYS = {
  NUDGE_IN_APP_DELAY_HOURS: "nudge.in_app_delay_hours",
  NUDGE_EMAIL_DELAY_HOURS: "nudge.email_delay_hours",
  MAX_AUCTION_INVITATIONS: "auction.max_invitations",
  INVENTORY_HEALTH_THRESHOLD: "inventory.health_threshold",
  AFFILIATE_MIN_PAYOUT_CENTS: "affiliate.min_payout_cents",
  PLATFORM_MAINTENANCE_MODE: "platform.maintenance_mode",
} as const;
