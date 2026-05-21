'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, User } from 'lucide-react';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { StageBadge } from './StageBadge';
import type { LifecycleStage } from '@/lib/types/crm';

type Result = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  lifecycle_stage: LifecycleStage;
};

export function GlobalSearch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      // Defer focus to next tick so the input is mounted.
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = debounced.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/search?q=${encodeURIComponent(trimmed)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setResults((json.contacts as Result[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = results[activeIndex];
        if (target) {
          router.push(`/admin/crm/contacts/${target.id}`);
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, activeIndex, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        className="bg-white border border-gray-300 rounded-xl w-full max-w-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search className="w-4 h-4 text-gray-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search contacts by name, email, or phone…"
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          )}
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-400 rounded"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {debounced.trim().length < 2 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              Type at least 2 characters to search
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No results for &ldquo;{debounced}&rdquo;
            </div>
          ) : (
            <div>
              <div className="px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider bg-white/50">
                Contacts
              </div>
              {results.map((r, i) => {
                const name =
                  [r.first_name, r.last_name].filter(Boolean).join(' ') ||
                  r.email ||
                  r.phone ||
                  'Unknown';
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      router.push(`/admin/crm/contacts/${r.id}`);
                      onClose();
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      i === activeIndex ? 'bg-gray-50/80' : 'hover:bg-gray-100/40'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-xs font-semibold text-gray-900 shrink-0">
                      {(r.first_name?.[0] ?? r.email?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate">{name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {r.email ?? r.phone ?? '—'}
                      </div>
                    </div>
                    <StageBadge stage={r.lifecycle_stage} size="sm" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 text-[10px] text-gray-500 border-t border-gray-200 flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 bg-gray-50 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-gray-50 rounded">↵</kbd> select</span>
          <span><kbd className="px-1 py-0.5 bg-gray-50 rounded">esc</kbd> close</span>
          <User className="w-3 h-3 ml-auto opacity-30" />
        </div>
      </div>
    </div>
  );
}
