// System 2 ENH — Natural Language Search Input Component
// Buyer types plain English → Groq interprets → structured filters applied
// Shows interpretation chip: "Showing results matching: [query]"

"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Loader2 } from "lucide-react";

interface NLSearchInputProps {
  onFiltersApplied: (params: Record<string, string>, interpretation: string) => void;
  onClear: () => void;
  placeholder?: string;
}

export default function NLSearchInput({ onFiltersApplied, onClear, placeholder = "Describe the car you're looking for…" }: NLSearchInputProps) {
  const [query, setQuery] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [activeInterpretation, setActiveInterpretation] = useState<string | null>(null);
  const [aiError, setAiError] = useState(false);

  const interpret = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 5) return;
    setInterpreting(true);
    setAiError(false);

    try {
      const res = await fetch("/api/buyer/search/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      const data = await res.json() as {
        success: boolean;
        data: { interpretation: string; params: Record<string, string>; confidence: string } | null
      };

      if (res.ok && data.success && data.data) {
        setActiveInterpretation(data.data.interpretation);
        onFiltersApplied(data.data.params, data.data.interpretation);
      } else {
        // AI unavailable — fall back to plain text search
        setAiError(true);
        onFiltersApplied({ q }, q);
        setActiveInterpretation(q);
      }
    } catch {
      setAiError(true);
      onFiltersApplied({ q }, q);
      setActiveInterpretation(q);
    } finally {
      setInterpreting(false);
    }
  }, [onFiltersApplied]);

  function handleClear() {
    setQuery("");
    setActiveInterpretation(null);
    setAiError(false);
    onClear();
  }

  return (
    <div className="space-y-2" data-testid="nl-search-input">
      {/* NL input bar */}
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 focus-within:ring-2 focus-within:ring-[#0B5FD1]/30">
        <Sparkles size={16} className="text-[#0B5FD1] shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && interpret(query)}
          placeholder={placeholder}
          data-testid="nl-search-text-input"
          className="flex-1 text-sm outline-none placeholder:text-slate-400 text-slate-800 bg-transparent"
        />
        {interpreting ? (
          <Loader2 size={15} className="text-slate-400 animate-spin shrink-0" />
        ) : (
          <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => interpret(query)}
            disabled={!query.trim() || interpreting} data-testid="nl-interpret-btn">
            Search
          </Button>
        )}
      </div>

      {/* Interpretation chip */}
      {activeInterpretation && (
        <div className="flex items-center gap-2" data-testid="nl-interpretation-chip">
          <div className="flex items-center gap-1.5 bg-[#0B5FD1]/8 border border-[#0B5FD1]/20 text-[#0B5FD1] text-xs px-3 py-1.5 rounded-full">
            <Sparkles size={11} />
            <span>Showing results matching: <strong>{activeInterpretation}</strong></span>
            {aiError && <span className="ml-1 text-slate-400">(plain search)</span>}
          </div>
          <button onClick={handleClear} data-testid="nl-clear-btn"
            className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
