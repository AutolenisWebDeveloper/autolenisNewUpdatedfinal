"use client";

import { useState } from "react";
import {
  Building2, MapPinned, Gauge, Loader2, CheckCircle2, XCircle, Play,
  type LucideIcon,
} from "lucide-react";

interface Control {
  label: string;
  endpoint: string;
  description: string;
  icon: LucideIcon;
}

const CONTROLS: Control[] = [
  {
    label: "Sync Dealer Intelligence",
    endpoint: "/api/admin/amips/sync-dealer-intelligence",
    description: "Populate dealer_intelligence from the Gemini Maps cache + recompute density.",
    icon: Building2,
  },
  {
    label: "Sync Market Intelligence",
    endpoint: "/api/admin/amips/sync-market-intelligence",
    description: "Populate the top 25 metros (Census population + dealer-derived scores).",
    icon: MapPinned,
  },
  {
    label: "Compute Market Scores",
    endpoint: "/api/admin/amips/compute-market-scores",
    description: "Pre-compute Market Scores for every make/model x metro combination.",
    icon: Gauge,
  },
];

type RunState = { status: "idle" | "running" | "done" | "error"; message?: string };

export default function AmipsSyncControls() {
  const [state, setState] = useState<Record<string, RunState>>({});

  async function run(c: Control) {
    setState((s) => ({ ...s, [c.endpoint]: { status: "running" } }));
    try {
      const res = await fetch(c.endpoint, { method: "POST" });
      const json = (await res.json()) as
        | { success: true; data: Record<string, number> }
        | { error: { message: string } };
      if (!res.ok || !("success" in json)) {
        const msg = "error" in json ? json.error.message : `HTTP ${res.status}`;
        setState((s) => ({ ...s, [c.endpoint]: { status: "error", message: msg } }));
        return;
      }
      const summary = Object.entries(json.data)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      setState((s) => ({ ...s, [c.endpoint]: { status: "done", message: summary } }));
    } catch (err) {
      setState((s) => ({
        ...s,
        [c.endpoint]: { status: "error", message: (err as Error).message },
      }));
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {CONTROLS.map((c) => {
        const rs = state[c.endpoint] ?? { status: "idle" };
        const running = rs.status === "running";
        return (
          <div
            key={c.endpoint}
            className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm transition-all hover:border-[#BFDBFE] hover:shadow-md hover:shadow-al-primary/5"
            data-testid={`amips-control-${c.endpoint}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-al-primary-subtle flex items-center justify-center">
                <c.icon size={15} className="text-al-primary" />
              </div>
              {running && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-al-primary">
                  <Loader2 size={11} className="animate-spin" />
                  Running
                </span>
              )}
            </div>
            <p className="text-sm font-bold text-[#0F172A]">{c.label}</p>
            <p className="mt-1 text-xs text-[#94A3B8] leading-snug flex-1">{c.description}</p>
            <button
              type="button"
              onClick={() => run(c)}
              disabled={running}
              className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-al-primary px-3 py-2 text-xs font-semibold text-white shadow-md shadow-al-primary/20 transition-colors hover:bg-al-primary-hover disabled:opacity-50 disabled:shadow-none"
            >
              {running ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play size={12} />
                  Run Sync
                </>
              )}
            </button>
            {rs.status === "done" && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] font-medium text-[#059669]">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
                <span className="break-words">{rs.message}</span>
              </p>
            )}
            {rs.status === "error" && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] font-medium text-[#DC2626]">
                <XCircle size={13} className="shrink-0 mt-0.5" />
                <span className="break-words">{rs.message}</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
