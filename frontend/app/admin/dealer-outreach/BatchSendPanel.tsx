"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ChevronDown, ChevronRight } from "lucide-react";

interface EligibleProspect {
  id: string;
  name: string;
  email: string;
  city: string | null;
  state: string | null;
}

const MAX_BATCH = 50;

export default function BatchSendPanel({ eligible }: { eligible: EligibleProspect[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (eligible.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BATCH) next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(eligible.slice(0, MAX_BATCH).map((p) => p.id)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  async function sendBatch() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Queue initial outreach emails to ${selected.size} dealer(s)? Sends run in the background with a short delay between each.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/dealer-outreach/send-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerProspectIds: Array.from(selected),
          outreachType: "initial",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      window.alert(`Queued ${body?.data?.queued ?? selected.size} email(s). Refresh in ~1 min.`);
      clearAll();
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Batch send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <Mail size={16} className="text-[#0B5FD1]" />
          Batch Email Outreach — {eligible.length} dealer(s) with an email and no send yet
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={selectAll}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Select first {Math.min(MAX_BATCH, eligible.length)}
            </button>
            <button
              onClick={clearAll}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
            <button
              onClick={sendBatch}
              disabled={busy || selected.size === 0}
              className="rounded-md bg-[#0B5FD1] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
            >
              {busy ? "Queuing…" : `Send Batch (${selected.size})`}
            </button>
            <span className="text-xs text-slate-400">Max {MAX_BATCH} per batch.</span>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border border-slate-100">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {eligible.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 break-all">{p.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
