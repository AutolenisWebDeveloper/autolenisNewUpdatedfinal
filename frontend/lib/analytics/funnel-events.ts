import { logger } from "@/lib/logger";
// Centralized funnel-event taxonomy. Every LP/TY surface fires events through
// this single channel — GA4, Microsoft Clarity, dataLayer. Pixel-specific
// events (FB/TikTok) still fire from the calling component because they need
// custom event names that don't match this taxonomy.

export type FunnelEvent =
  | "lp_view"
  | "lp_hero_cta_click"
  | "lp_vsl_play"
  | "lp_vsl_complete_25"
  | "lp_vsl_complete_50"
  | "lp_vsl_complete_75"
  | "lp_vsl_complete_100"
  | "lp_form_step_view"
  | "lp_form_step_complete"
  | "lp_form_submit"
  | "lp_form_abandon"
  | "lp_exit_intent_shown"
  | "lp_exit_intent_cta"
  | "lp_sticky_cta_click"
  | "lp_faq_open"
  | "ty_view"
  | "ty_activate_cta_click"
  | "ty_complete_submit"
  | "ty_complete_skip"
  | "deposit_paid";

interface FunnelEventPayload {
  step?: number;
  campaign?: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  vehicle_type?: string;
  budget?: string;
  timeline?: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    // `ttq` (TikTok Pixel) is declared globally in types/tiktok.d.ts.
    dataLayer?: unknown[];
    AutoLenisAnalytics?: { trackVehicleRequest?: () => void };
  }
}

export function trackFunnelEvent(
  event: FunnelEvent,
  payload: FunnelEventPayload = {},
): void {
  if (typeof window === "undefined") return;
  try {
    window.gtag?.("event", event, payload);
    window.clarity?.("event", event);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...payload });
    if (process.env.NODE_ENV !== "production") {
      logger.info("[funnel]", event, payload);
    }
  } catch {
    // Analytics must never throw into UX.
  }
}
