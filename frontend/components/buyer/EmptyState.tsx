// Group 7 (7D) — Reusable buyer empty-state surface.
// Consistent icon + heading + body + optional CTA for the buyer portal's
// "nothing here yet" moments (no auctions, no offers, prequal pending,
// insurance needed). Keeps every empty screen on-brand and reassuring.

import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  /** Scenario slug — drives data-testid="empty-state-{scenario}". */
  scenario: string;
  icon: LucideIcon;
  heading: string;
  body: string;
  /** Optional call-to-action. Omit for reassurance-only states. */
  cta?: { label: string; href: string };
  /** Visual tone. "neutral" (default) or "active" (blue accent for live states). */
  tone?: "neutral" | "active";
}

export default function EmptyState({
  scenario,
  icon: Icon,
  heading,
  body,
  cta,
  tone = "neutral",
}: EmptyStateProps) {
  const accent = tone === "active" ? "#0B5FD1" : "#64748b";
  return (
    <div
      data-testid={`empty-state-${scenario}`}
      className="text-center py-14 px-6 bg-white border border-slate-200 rounded-2xl"
    >
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
        style={{
          backgroundColor: tone === "active" ? "rgba(11,95,209,0.08)" : "#f1f5f9",
          border: tone === "active" ? "1px solid rgba(11,95,209,0.2)" : "1px solid #e2e8f0",
        }}
      >
        <Icon size={24} style={{ color: accent }} />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{heading}</h3>
      <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">{body}</p>
      {cta && (
        <div className="mt-6">
          <Button href={cta.href} data-testid={`empty-state-${scenario}-cta`}>
            {cta.label}
          </Button>
        </div>
      )}
    </div>
  );
}
