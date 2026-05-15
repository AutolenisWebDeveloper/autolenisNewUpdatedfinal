"use client";

import { useState } from "react";
import { Search, ExternalLink, Loader2 } from "lucide-react";
import { openBuyerPageAsAdmin } from "@/lib/admin/preview";

interface Props {
  stageRoute: string;
  stageLabel: string;
}

interface BuyerResult {
  id: string;
  name: string;
  email: string;
}

export default function BuyerPickerButton({ stageRoute, stageLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuyerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/buyers?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json() as { success?: boolean; data?: { buyers: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }> } };
      const buyers = data.data?.buyers ?? [];
      setResults(buyers.map(b => ({
        id: b.id,
        name: `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || "—",
        email: b.email,
      })));
    } catch { setResults([]); }
    finally { setSearching(false); }
  }

  async function openBuyer(buyer: BuyerResult) {
    setOpening(buyer.id);
    setOpen(false);
    await openBuyerPageAsAdmin({ buyerId: buyer.id, stageRoute });
    setOpening(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!!opening}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] border border-[#0B5FD1]/30 bg-white px-3 py-1.5 rounded-lg hover:bg-[#0B5FD1]/5 whitespace-nowrap shrink-0 disabled:opacity-50"
      >
        {opening ? <Loader2 size={11} className="animate-spin" /> : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        )}
        Open Buyer Page
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
            <h3 className="font-bold text-base text-slate-900 mb-1">
              Preview &ldquo;{stageLabel}&rdquo; Stage
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Search for a buyer to open their {stageLabel.toLowerCase()} page in admin preview mode.
            </p>

            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => search(e.target.value)}
                placeholder="Search buyer name or email…"
                className="w-full pl-8 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
              />
              {searching && (
                <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
              )}
            </div>

            <div className="space-y-1 max-h-52 overflow-y-auto">
              {results.length === 0 && query.length >= 2 && !searching && (
                <p className="text-xs text-slate-400 text-center py-4">No buyers found</p>
              )}
              {results.map(buyer => (
                <button key={buyer.id} onClick={() => openBuyer(buyer)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-200 text-left">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{buyer.name}</p>
                    <p className="text-xs text-slate-400">{buyer.email}</p>
                  </div>
                  <ExternalLink size={13} className="text-slate-300 shrink-0" />
                </button>
              ))}
            </div>

            <button onClick={() => setOpen(false)}
              className="w-full mt-3 border border-slate-200 text-slate-500 text-sm py-2 rounded-xl hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
