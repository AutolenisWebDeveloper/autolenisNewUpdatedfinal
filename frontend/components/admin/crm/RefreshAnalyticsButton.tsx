'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';

export function RefreshAnalyticsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function onClick() {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/operations/analytics/refresh', {
          method: 'POST',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Refresh failed (${res.status})`);
        }
        setMsg('Refreshed');
        router.refresh();
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Refresh failed');
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-gray-700 hover:border-gray-600 text-gray-300 rounded-lg disabled:opacity-50 transition-colors"
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Refresh analytics
      </button>
      {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
    </div>
  );
}
