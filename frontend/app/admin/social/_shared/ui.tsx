// Shared presentational primitives for the /admin/social dashboard: platform
// icon, status/video/lead badges, and their style maps. Extracted from
// SocialDashboardClient.tsx so tabs share one visual language. These are local
// to the social console; the platform-wide kit lives in @/components/ui/kit.

import { Facebook, Instagram, Youtube, Linkedin, Music2, Radio, Loader2 } from "lucide-react";

export const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "linkedin"] as const;

export function platformIcon(platform: string, size = 14) {
  switch (platform) {
    case "facebook": return <Facebook size={size} />;
    case "instagram": return <Instagram size={size} />;
    case "youtube": return <Youtube size={size} />;
    case "linkedin": return <Linkedin size={size} />;
    case "tiktok": return <Music2 size={size} />;
    default: return <Radio size={size} />;
  }
}

export const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-indigo-100 text-indigo-700",
  PUBLISHING: "bg-cyan-100 text-cyan-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-slate-100 text-slate-500",
  REJECTED: "bg-rose-100 text-rose-700",
};
export const VIDEO_STYLES: Record<string, string> = {
  SCRIPT_READY: "bg-slate-100 text-slate-600",
  VIDEO_QUEUED: "bg-amber-100 text-amber-700",
  VIDEO_GENERATING: "bg-blue-100 text-blue-700",
  VIDEO_READY: "bg-emerald-100 text-emerald-700",
  VIDEO_FAILED: "bg-red-100 text-red-700",
  PUBLISH_READY: "bg-emerald-100 text-emerald-700",
};
export const LEAD_STATUS_STYLES: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  NURTURING: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-emerald-100 text-emerald-700",
  DEAD: "bg-slate-100 text-slate-500",
};

export function LeadStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${LEAD_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function VideoBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${VIDEO_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status === "VIDEO_GENERATING" && <Loader2 size={10} className="animate-spin" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}
