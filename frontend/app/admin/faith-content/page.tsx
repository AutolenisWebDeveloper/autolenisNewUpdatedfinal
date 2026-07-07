// /admin/faith-content — System 25 Faith & Encouragement CMS hub
// Accessible only to Super Admin and Admin roles

import { requireAdmin } from "@/lib/auth/admin-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { FAITH_VERSE_ENABLED_PAGES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function AdminFaithContentPage() {
  const admin = await requireAdmin();
  // Only SUPER_ADMIN can manage faith content
  if (admin.role !== "SUPER_ADMIN" && admin.role !== "OPERATIONS_ADMIN") {
    return <div className="p-8 text-slate-500" data-testid="faith-content-access-denied">Access restricted to Super Admin and Operations Admin.</div>;
  }

  const [verseCount, messageCount, hopeCount] = await Promise.all([
    prisma.verseLibrary.count({ where: { isActive: true } }),
    prisma.encouragementMessage.count({ where: { isActive: true } }),
    prisma.hopePageContent.count({ where: { isActive: true } }),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-faith-content-page">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Faith & Encouragement Content</h1>
        <Badge variant="secondary">System 25</Badge>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800" data-testid="faith-content-note">
        <p className="font-semibold mb-1">Content Guidelines</p>
        <p>All verses must be NKJV translation only. Born-again invitation appears on /hope page exclusively. Faith content must never interrupt conversion-critical flows.</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Active Verses", value: verseCount, sub: `of 468 NKJV total`, href: "/admin/faith-content/verses" },
          { label: "Encouragement Msgs", value: messageCount, href: "/admin/faith-content/messages" },
          { label: "Hope Page Sections", value: hopeCount, sub: "4 required sections", href: "/admin/faith-content/hope" },
        ].map(s => (
          <Link key={s.label} href={s.href} data-testid={`faith-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-5 text-center hover:border-al-primary/30 transition-colors">
            <p className="text-2xl font-bold text-al-primary">{s.value}</p>
            <p className="text-xs font-semibold text-slate-700 mt-0.5">{s.label}</p>
            {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
          </Link>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="faith-enabled-pages">
        <p className="font-semibold text-slate-800 text-sm mb-3">Verse-Enabled Pages ({FAITH_VERSE_ENABLED_PAGES.length})</p>
        <div className="flex flex-wrap gap-2">
          {FAITH_VERSE_ENABLED_PAGES.map(page => (
            <Badge key={page} variant="secondary" className="text-xs">{page}</Badge>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">Contact and Sign In pages have no verse or faith modules.</p>
      </div>

      <div className="flex gap-3">
        <Button href="/admin/faith-content/verses" data-testid="manage-verses-btn" variant="secondary">Manage Verse Library</Button>
        <Button href="/admin/faith-content/messages" data-testid="manage-messages-btn" variant="secondary">Manage Messages</Button>
        <Button href="/admin/faith-content/hope" data-testid="manage-hope-btn" variant="secondary">Manage /hope Page</Button>
      </div>
    </div>
  );
}
