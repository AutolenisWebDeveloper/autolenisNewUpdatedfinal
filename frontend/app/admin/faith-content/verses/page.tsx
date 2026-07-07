import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminFaithVersesPage() {
  await requireAdmin();
  const verses = await prisma.verseLibrary.findMany({ orderBy: { book: "asc" }, take: 100 });
  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-faith-verses-page">
      <div className="flex items-center gap-3 mb-6"><BookOpen size={20} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Verse Library — {verses.length} NKJV Verses</h1></div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-700">NKJV translation ONLY. No other translations permitted.</div>
      <div className="space-y-2">
        {verses.slice(0, 20).map(v => (
          <div key={v.id} data-testid={`verse-row-${v.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{v.reference}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate max-w-lg">{v.text.slice(0, 100)}…</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={v.isActive ? "green" : "gray"} className="text-xs">{v.isActive ? "Active" : "Inactive"}</Badge>
              <Badge variant="secondary" className="text-xs">{v.translation}</Badge>
            </div>
          </div>
        ))}
        {verses.length > 20 && <p className="text-xs text-slate-400 text-center py-2">Showing 20 of {verses.length} verses</p>}
      </div>
    </div>
  );
}
