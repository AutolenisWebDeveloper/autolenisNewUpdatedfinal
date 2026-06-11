'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from './ui';

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
      <Button
        variant="secondary"
        onClick={onClick}
        disabled={pending}
        data-testid="crm-analytics-refresh"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Refresh analytics
      </Button>
      {msg && <span className="text-[11px] text-[var(--crm-text-tertiary)]">{msg}</span>}
    </div>
  );
}
