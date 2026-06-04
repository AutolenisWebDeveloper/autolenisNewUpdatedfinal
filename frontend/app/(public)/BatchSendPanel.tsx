"use client";

// Phase 4B-3 — batch outreach panel. Lists dealers that have an email but no
// email outreach yet, lets the founder select a subset, and queues an initial
// outreach email to each via /api/admin/dealer-outreach/send-batch.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

export interface BatchEligibleDealer {
  id: string;
  name: string;
  email: string;
  city: string | null;
  state: string | null;
}

interface BatchSendPanelProps {
  eligible: BatchEligibleDealer[];
}

interface BatchSendData {
  queued: number;
  message: string;
}

export default function BatchSendPanel({ eligible }: BatchSendPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (eligible.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === eligible.length ? new Set() : new Set(eligible.map((d) => d.id)),
    );
  }

  async function send() {
    if (selected.size === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/dealer-outreach/send-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerProspectIds: Array.from(selected),
          outreachType: "initial",
        }),
      });
      const json = (await res.json()) as
        | { success: true; data: BatchSendData }
        | { error: { message: string } };
      if (!res.ok || !("success" in json)) {
        setNote("error" in json ? json.error.message : "Batch send failed");
        return;
      }
      setNote(json.data.message);
      setSelected(new Set());
      setTimeout(() => startTransition(() => router.refresh()), 6000);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Batch send failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Batch outreach · {eligible.length} dealer{eligible.length === 1 ? "" : "s"} ready
        </h2>
        <div className="flex items-center gap-2">
          {note && <span className="text-xs text-slate-500">{note}</span>}
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {selected.size === eligible.length ? "Clear all" : "Select all"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={disabled || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0B5FD1] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0a52b5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {disabled ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send to {selected.size} selected
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {eligible.map((d) => (
          <label
            key={d.id}
            className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.has(d.id)}
              onChange={() => toggle(d.id)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block font-medium text-slate-800 truncate">{d.name}</span>
              <span className="block text-xs text-slate-500 truncate">{d.email}</span>
              <span className="block text-xs text-slate-400 truncate">
                {[d.city, d.state].filter(Boolean).join(", ") || "—"}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
