// Feature 25 — Marketing Asset Library
// Serves real downloadable assets listed in DOWNLOADABLE_ASSETS manifest.
// Update DOWNLOADABLE_ASSETS when adding files to /public/affiliate-assets/.
// Text templates are real and always available via MarketingKit.

import "server-only";
import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { FileText, Download, ImageIcon, FileImage, Film } from "lucide-react";
import MarketingKit from "@/components/affiliate/MarketingKit";

export const dynamic = "force-dynamic";

// Static manifest of downloadable affiliate assets.
// Update this list when adding files to /public/affiliate-assets/.
// Do NOT use fs.existsSync — it does not work reliably on Vercel at runtime.
const DOWNLOADABLE_ASSETS: {
  id: string;
  label: string;
  filename: string;
  description: string;
  icon: "image" | "file" | "video";
}[] = [
  // Add real filenames as assets are created, e.g.:
  // { id: "banner-leaderboard", label: "Banner — Leaderboard (728×90)", filename: "banner-728x90.png", description: "Standard leaderboard banner", icon: "image" },
  // { id: "one-pager", label: "AutoLenis One-Pager (PDF)", filename: "autolenis-one-pager.pdf", description: "Platform explainer PDF", icon: "file" },
];

export default async function AffiliateResourcesPage() {
  const affiliate = await requireAffiliate();
  const referralLink = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/signup?ref=${affiliate.referralCode}`;

  const iconMap = {
    image: ImageIcon,
    file: FileImage,
    video: Film,
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="affiliate-resources-page">
      <div className="flex items-center gap-3 mb-2">
        <FileText size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Marketing Resources</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        FTC-compliant templates and assets — ready to use.
      </p>

      {/* Downloadable assets section */}
      <div className="mb-10" data-testid="downloadable-assets-section">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Downloadable Assets</p>

        {DOWNLOADABLE_ASSETS.length > 0 ? (
          <div className="space-y-3 mb-4">
            {DOWNLOADABLE_ASSETS.map(asset => {
              const Icon = iconMap[asset.icon];
              return (
                <div key={asset.id} data-testid={`asset-item-${asset.id}`}
                  className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl px-5 py-4">
                  <div className="p-2 bg-al-primary/8 rounded-lg shrink-0">
                    <Icon size={16} className="text-al-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{asset.label}</p>
                    <p className="text-xs text-slate-500 truncate">{asset.description}</p>
                  </div>
                  <a
                    href={`/affiliate-assets/${asset.filename}`}
                    download={asset.filename}
                    data-testid={`download-btn-${asset.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-al-primary/10 text-al-primary hover:bg-al-primary/20 transition-colors shrink-0"
                  >
                    <Download size={12} />Download
                  </a>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 border-dashed rounded-xl p-6 text-center" data-testid="assets-empty-state">
            <Download size={28} className="text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-600 mb-1">Downloadable assets coming soon</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Branded banners, social kits, and PDF one-pagers will appear here once they are
              published. In the meantime, use the copy-and-paste templates below to start sharing.
            </p>
            <ul className="mt-4 space-y-1 text-left inline-block text-xs text-slate-500">
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />Banners (728×90, 300×250, 160×600)</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />Social Media Kit (ZIP)</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />AutoLenis One-Pager (PDF)</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />Email Signature Template</li>
            </ul>
          </div>
        )}
      </div>

      {/* Copy-and-paste text templates */}
      <MarketingKit referralCode={affiliate.referralCode} referralLink={referralLink} />
    </div>
  );
}
