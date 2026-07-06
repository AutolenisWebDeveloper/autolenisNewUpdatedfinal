// lib/observability/alert.ts — severity-tagged alerting seam.
//
// One place to route "wake someone up" vs "record it" so ops can wire paging
// (PagerDuty/Opsgenie/Slack) to Sentry alert rules keyed on these tags without
// touching call sites. Everything degrades to logger when Sentry is absent.

import { logger } from "@/lib/logger";

type AlertContext = Record<string, unknown>;

function toSentry(level: "fatal" | "error" | "warning", message: string, tags: Record<string, string>, ctx: AlertContext) {
  try {
    const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");
    Sentry.captureMessage(message, { level, tags, extra: ctx });
  } catch {
    // Sentry unavailable — logger below is the record of last resort.
  }
}

// HIGH severity — must reach an on-call human (revenue/security incident).
// Ops routes Sentry alert rule on tag alert_channel=oncall to the pager.
export function pageOnCall(message: string, ctx: AlertContext = {}): void {
  logger.error(`[PAGE] ${message}`, ctx);
  toSentry("fatal", message, { alert_channel: "oncall", severity: "high" }, ctx);
}

// MEDIUM severity — notify (dashboard/Slack), does not page.
export function notifyOncall(message: string, ctx: AlertContext = {}): void {
  logger.error(`[ALERT] ${message}`, ctx);
  toSentry("error", message, { alert_channel: "notify", severity: "medium" }, ctx);
}
