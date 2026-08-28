'use client';

import { useEffect, useState } from 'react';
import { Search, Bell, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';
import { CopilotPanel } from './CopilotPanel';

/**
 * CrmShell — the CRM content shell.
 *
 * Batch 2 IA: this component used to own a second, complete navigation system
 * (its own 240px sidebar, brand, collapse toggle and mobile drawer) rendered
 * INSTEAD of the admin chrome, because app/admin/layout.tsx returned bare
 * children for /admin/crm* and /admin/operations*. Entering the CRM therefore
 * repainted the whole console and hid 16 CRM routes from the main rail.
 *
 * The navigation moved to AdminSidebar (see lib/admin/nav.ts, section
 * "Engage"). What remains here is everything that was NOT navigation and is
 * genuinely CRM-specific:
 *   - the `.crm-root` scope, which is where the --crm-* design tokens apply;
 *   - the ⌘K command palette (GlobalSearch) and the Copilot panel;
 *   - the CRM's light/dark preference.
 *
 * No third navigation system was introduced, and no CRM capability was
 * removed. The unread/overdue badges this shell used to fetch now render on
 * the Engage entries in AdminSidebar, against the same
 * /api/admin/crm/badges endpoint.
 */
export function CrmShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="crm-root min-h-full bg-[var(--crm-bg-secondary)] text-[var(--crm-text-primary)]"
      data-theme={theme}
      data-testid="crm-shell"
    >
      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] px-3',
        )}
        data-testid="crm-topbar"
      >
        <div className="flex flex-1 items-center justify-center px-2">
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="crm-command-pill"
            className="flex w-full max-w-md items-center gap-2 rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-3 py-1.5 text-[13px] text-[var(--crm-text-tertiary)] transition-colors hover:border-[var(--crm-border-strong)] hover:text-[var(--crm-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search contacts, leads, tasks…</span>
            <kbd className="rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] bg-[var(--crm-bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--crm-text-tertiary)]">
              ⌘K
            </kbd>
          </button>
        </div>

        <button
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          aria-label="Toggle theme"
          data-testid="crm-theme-toggle"
          className="rounded-[var(--crm-radius-sm)] p-2 text-[var(--crm-text-tertiary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>

        <button
          className="rounded-[var(--crm-radius-sm)] p-2 text-[var(--crm-text-tertiary)] hover:bg-[var(--crm-bg-tertiary)] hover:text-[var(--crm-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)]"
          aria-label="Notifications"
          data-testid="crm-notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <span
          aria-hidden="true"
          data-testid="crm-account"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--crm-primary)] text-[12px] font-medium text-[var(--crm-on-primary)]"
        >
          AL
        </span>
      </header>

      <main className="min-h-[calc(100vh-56px)] bg-[var(--crm-bg-secondary)]">{children}</main>

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenCopilot={() => setCopilotOpen(true)}
      />
      <CopilotPanel open={copilotOpen} onClose={() => setCopilotOpen(false)} />
    </div>
  );
}
