"use client";

import { useState } from "react";

interface Control {
  label: string;
  endpoint: string;
  description: string;
}

const CONTROLS: Control[] = [
  {
    label: "Sync Dealer Intelligence",
    endpoint: "/api/admin/amips/sync-dealer-intelligence",
    description: "Populate dealer_intelligence from the Gemini Maps cache + recompute density.",
  },
  {
    label: "Sync Market Intelligence",
    endpoint: "/api/admin/amips/sync-market-intelligence",
    description: "Populate the top 25 metros (Census population + dealer-derived scores).",
  },
  {
    label: "Compute Market Scores",
    endpoint: "/api/admin/amips/compute-market-scores",
    description: "Pre-compute Market Scores for every make/model x metro combination.",
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
    <div className="grid gap-3 sm:grid-cols-3">
      {CONTROLS.map((c) => {
        const rs = state[c.endpoint] ?? { status: "idle" };
        const running = rs.status === "running";
        return (
          <div
            key={c.endpoint}
            className="rounded-xl border border-slate-200 bg-white p-4"
            data-testid={`amips-control-${c.endpoint}`}
          >
            <p className="text-sm font-semibold text-slate-900">{c.label}</p>
            <p className="mt-1 text-xs text-slate-500">{c.description}</p>
            <button
              type="button"
              onClick={() => run(c)}
              disabled={running}
              className="mt-3 inline-flex items-center rounded-lg bg-[#0B5FD1] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {running ? "Running…" : "Run"}
            </button>
            {rs.status === "done" && (
              <p className="mt-2 text-xs font-medium text-emerald-600">✓ {rs.message}</p>
            )}
            {rs.status === "error" && (
              <p className="mt-2 text-xs font-medium text-red-600">✗ {rs.message}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
