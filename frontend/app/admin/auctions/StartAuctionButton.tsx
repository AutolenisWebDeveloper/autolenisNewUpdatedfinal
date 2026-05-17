"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gavel, Search, Loader2, X } from "lucide-react";

interface BuyerRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export default function StartAuctionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuyerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `/api/admin/buyers?q=${encodeURIComponent(query)}&perPage=20`;
    const timer = setTimeout(() => {
      fetch(url)
        .then(async (r) => {
          const json = (await r.json()) as {
            success?: boolean;
            data?: { buyers: BuyerRow[] };
            error?: { message: string };
          };
          if (cancelled) return;
          if (!json.success) {
            setError(json.error?.message ?? "Failed to load buyers");
            setResults([]);
          } else {
            setResults(json.data?.buyers ?? []);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Network error");
          setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  function pickBuyer(b: BuyerRow) {
    setOpen(false);
    router.push(`/admin/buyers/${b.id}?tab=auctions`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="start-auction-button"
        className="inline-flex items-center gap-1.5 bg-[#0B5FD1] text-white text-xs font-semibold px-3.5 py-2 rounded-xl hover:bg-[#0944a8]"
      >
        <Gavel size={12} /> Start Auction
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24"
          onClick={() => setOpen(false)}
          data-testid="start-auction-modal"
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Gavel size={14} className="text-[#0B5FD1]" />
                <h3 className="text-sm font-bold text-slate-900">Start auction — pick a buyer</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  data-testid="start-auction-search"
                  className="w-full pl-8 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                />
                {loading && (
                  <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
                )}
              </div>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
              {error && (
                <div className="p-4 text-xs text-red-600" data-testid="start-auction-error">
                  {error}
                </div>
              )}
              {!error && !loading && results.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-400">No buyers found</div>
              )}
              {results.map((b) => {
                const name = [b.firstName, b.lastName].filter(Boolean).join(" ") || "Unnamed buyer";
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => pickBuyer(b)}
                    data-testid={`start-auction-buyer-${b.id}`}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
                      <p className="text-xs text-slate-400 truncate">{b.email}</p>
                    </div>
                    <span className="text-[10px] font-semibold text-[#0B5FD1] uppercase tracking-wide shrink-0">
                      Select
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
