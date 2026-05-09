// Feature 16 — AI Concierge Proactive Nudges (Phase 3 — Buyer Deal Confidence)
// Nudges are driven ONLY from real buyer state: prequal expiry, shortlist count,
// auction countdown. No fabricated timers or fake data.
"use client";

import { useState } from "react";
import Link from "next/link";
import { X, TrendingUp, Heart, Gavel, AlertCircle, ArrowRight } from "lucide-react";

export interface BuyerNudge {
  id: string;
  stage: string;
  icon: "prequal" | "shortlist" | "auction" | "alert";
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  urgency: "high" | "medium" | "low";
}

interface Props {
  nudges: BuyerNudge[];
}

const ICON_MAP: Record<BuyerNudge["icon"], React.ElementType> = {
  prequal: TrendingUp,
  shortlist: Heart,
  auction: Gavel,
  alert: AlertCircle,
};

const URGENCY_STYLE: Record<BuyerNudge["urgency"], string> = {
  high:   "border-orange-200 bg-orange-50",
  medium: "border-[#0B5FD1]/20 bg-[#0B5FD1]/4",
  low:    "border-slate-200 bg-white",
};

const URGENCY_ICON_STYLE: Record<BuyerNudge["urgency"], string> = {
  high:   "bg-orange-100 text-orange-600",
  medium: "bg-[#0B5FD1]/10 text-[#0B5FD1]",
  low:    "bg-slate-100 text-slate-500",
};

export default function ProactiveNudgesPanel({ nudges: initialNudges }: Props) {
  const [visible, setVisible] = useState<BuyerNudge[]>(initialNudges);

  async function dismiss(nudge: BuyerNudge) {
    setVisible(prev => prev.filter(n => n.id !== nudge.id));
    try {
      await fetch("/api/buyer/nudge/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: nudge.stage }),
      });
    } catch {
      // Non-critical — dismiss is best-effort; UI already reflects dismissed state
    }
  }

  if (visible.length === 0) return null;

  return (
    <div className="space-y-3 mb-6" data-testid="proactive-nudges-panel">
      {visible.map((nudge) => {
        const Icon = ICON_MAP[nudge.icon];
        return (
          <div
            key={nudge.id}
            data-testid={`nudge-${nudge.stage}`}
            className={`relative flex items-start gap-3 border rounded-xl p-4 ${URGENCY_STYLE[nudge.urgency]}`}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${URGENCY_ICON_STYLE[nudge.urgency]}`}>
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{nudge.title}</p>
              <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{nudge.body}</p>
              <Link
                href={nudge.actionHref}
                data-testid={`nudge-action-${nudge.stage}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B5FD1] hover:underline mt-2"
              >
                {nudge.actionLabel} <ArrowRight size={11} />
              </Link>
            </div>
            <button
              onClick={() => dismiss(nudge)}
              data-testid={`nudge-dismiss-${nudge.stage}`}
              aria-label="Dismiss"
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-black/5 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
