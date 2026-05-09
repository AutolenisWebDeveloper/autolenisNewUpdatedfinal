import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminFaithHopePage() {
  await requireAdmin();
  const sections = await prisma.hopePageContent.findMany({ orderBy: { order: "asc" } });
  const required = ["opening", "encouragement", "born-again", "resources"];
  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="admin-faith-hope-page">
      <div className="flex items-center gap-3 mb-4"><BookOpen size={20} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">/hope Page CMS</h1></div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-xs text-amber-700" data-testid="hope-born-again-notice">
        Born-again invitation section appears ONLY on /hope. It must never appear on any other page.
      </div>
      <div className="space-y-3">
        {required.map(sectionId => {
          const content = sections.find(s => s.section === sectionId);
          return (
            <div key={sectionId} data-testid={`hope-section-${sectionId}`} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-slate-800 text-sm capitalize">{sectionId.replace("-", " ")} section</p>
                <Badge variant={content?.isActive ? "green" : "amber"} className="text-xs">{content ? "Configured" : "Missing"}</Badge>
              </div>
              {content ? (
                <p className="text-xs text-slate-500 truncate">{content.body.slice(0, 120)}…</p>
              ) : (
                <p className="text-xs text-red-500">Required section not yet populated</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
