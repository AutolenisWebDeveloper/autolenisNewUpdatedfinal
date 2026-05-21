'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Inbox,
  CheckSquare,
  Send,
  FileText,
  Filter,
  ShieldOff,
  Zap,
  BarChart3,
  Activity,
  Search,
  Menu,
  X,
  Bell,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: 'unread' | 'overdue';
  exact?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    title: 'CRM',
    items: [
      { href: '/admin/crm',          label: 'Overview', icon: LayoutDashboard, exact: true },
      { href: '/admin/crm/contacts', label: 'Contacts', icon: Users },
      { href: '/admin/crm/leads',    label: 'Leads',    icon: UserPlus },
      { href: '/admin/crm/inbox',    label: 'Inbox',    icon: Inbox,        badge: 'unread' },
      { href: '/admin/crm/tasks',    label: 'Tasks',    icon: CheckSquare,  badge: 'overdue' },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { href: '/admin/crm/campaigns',   label: 'Campaigns',   icon: Send },
      { href: '/admin/crm/templates',   label: 'Templates',   icon: FileText },
      { href: '/admin/crm/segments',    label: 'Segments',    icon: Filter },
      { href: '/admin/crm/suppression', label: 'Suppression', icon: ShieldOff },
    ],
  },
  {
    title: 'Automation',
    items: [
      { href: '/admin/crm/automations', label: 'Workflows', icon: Zap },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/admin/crm/analytics', label: 'Analytics',  icon: BarChart3 },
      { href: '/admin/operations',    label: 'Operations', icon: Activity },
    ],
  },
];

function isActive(itemHref: string, pathname: string, exact?: boolean): boolean {
  if (exact) return pathname === itemHref;
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}

export function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [badges, setBadges] = useState<{ unread: number; overdue: number }>({
    unread: 0,
    overdue: 0,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/crm/badges')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) {
          setBadges({
            unread: Number(json.unread ?? 0),
            overdue: Number(json.overdue ?? 0),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 bg-gray-950/95 backdrop-blur border-b border-gray-800 flex items-center px-4 lg:pl-60">
        <button
          className="lg:hidden p-2 -ml-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-800/60"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center justify-center px-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 text-sm text-gray-500 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5 w-full max-w-md transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search contacts…</span>
            <kbd className="text-[10px] text-gray-600 bg-gray-950 border border-gray-800 px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
          </button>
        </div>
        <button
          className="p-2 text-gray-500 hover:text-gray-300 rounded-md hover:bg-gray-800/60"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 w-56 h-screen bg-gray-900 border-r border-gray-800 flex flex-col transition-transform',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="h-14 px-5 flex items-center justify-between border-b border-gray-800">
          <Link href="/admin/crm" className="text-sm font-bold text-white tracking-tight">
            AutoLenis <span className="text-blue-500">CRM</span>
          </Link>
          <button
            className="lg:hidden p-1 text-gray-500 hover:text-gray-300"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-2 pb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href, pathname, item.exact);
                  const badgeVal =
                    item.badge === 'unread'
                      ? badges.unread
                      : item.badge === 'overdue'
                        ? badges.overdue
                        : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors',
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60',
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && badgeVal > 0 && (
                        <span
                          className={cn(
                            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                            item.badge === 'unread'
                              ? 'bg-blue-500/20 text-blue-300'
                              : 'bg-red-500/20 text-red-300',
                          )}
                        >
                          {badgeVal > 99 ? '99+' : badgeVal}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-5 py-3 border-t border-gray-800">
          <Link
            href="/admin/dashboard"
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            ← Back to admin
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:pl-56 min-h-[calc(100vh-56px)]">{children}</main>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
