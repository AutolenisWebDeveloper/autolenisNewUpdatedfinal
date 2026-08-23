"use client";
// Settings tab (+ provider card) — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useEffect, useState, type ReactNode } from "react";
import { Facebook, Music2, Linkedin, Video } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { platformIcon } from "../_shared/ui";
import type { AutomationMode, FranchiseRow, PlatformConnection, ProviderConnections } from "../_shared/types";

function SettingsTab({
  automationMode, franchises, platformConnections, videoEnabled, showToast,
}: {
  automationMode: AutomationMode;
  franchises: FranchiseRow[];
  platformConnections: PlatformConnection[];
  videoEnabled: boolean;
  showToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<AutomationMode>(automationMode);
  const [connections, setConnections] = useState<ProviderConnections | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<ProviderConnections>("/api/admin/social/connections")
      .then((c) => { if (!cancelled) setConnections(c); })
      .catch((err) => showToast(err instanceof Error ? err.message : "Failed to load connections"));
    return () => { cancelled = true; };
  }, [showToast]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F172A] mb-1">Automation Mode</h2>
        <p className="text-xs text-[#64748B] mb-4">Controls how generated content flows to publishing. Set via SOCIAL_AUTOMATION_MODE.</p>
        <div className="space-y-2">
          {(["MANUAL_REVIEW", "HYBRID_AUTO", "FULL_AUTO"] as AutomationMode[]).map((m) => (
            <label key={m} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} data-testid={`mode-${m}`} />
              <span className="text-xs font-semibold text-[#0F172A]">{m.replace(/_/g, " ")}</span>
              {m === automationMode && <span className="text-[10px] text-emerald-600 font-bold">(current)</span>}
            </label>
          ))}
        </div>
        <button
          data-testid="save-mode"
          onClick={() => showToast("Mode is environment-controlled (SOCIAL_AUTOMATION_MODE). Update the env var to persist.")}
          className="mt-4 bg-al-primary text-white text-xs font-semibold px-4 py-2 rounded-lg">
          Save
        </button>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F172A] mb-3">Franchises ({franchises.length})</h2>
        <div className="grid md:grid-cols-2 gap-2">
          {franchises.map((f) => (
            <div key={f.id} className="flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0]">
              <div>
                <p className="text-xs font-semibold text-[#0F172A]">{f.name}</p>
                <p className="text-[10px] text-[#94A3B8]">{f.cadence} · {f.platforms.join(", ")}</p>
              </div>
              <div className="flex items-center gap-2">
                {f.requiresReview && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">REVIEW</span>}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${f.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{f.active ? "ACTIVE" : "OFF"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#0F172A] mb-1">Provider Connections</h2>
        <p className="text-xs text-[#64748B] mb-3">
          Video: {videoEnabled ? "enabled" : "disabled"} · Direct publishing: Meta / TikTok / LinkedIn (configured per access token). Buffer has been retired.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4" data-testid="provider-connections">
          <ProviderCard
            icon={<Facebook size={16} />}
            name="Meta"
            connected={connections?.meta.connected ?? false}
            detail="Facebook · Instagram"
          />
          <ProviderCard
            icon={<Music2 size={16} />}
            name="TikTok"
            connected={connections?.tiktok.connected ?? false}
            detail="Direct publishing"
          />
          <ProviderCard
            icon={<Linkedin size={16} />}
            name="LinkedIn"
            connected={connections?.linkedin.connected ?? false}
            detail={connections?.linkedin.pageId ? `Page ${connections.linkedin.pageId}` : "Direct publishing"}
          />
          <ProviderCard
            icon={<Video size={16} />}
            name="Runway ML"
            connected={connections?.runway.connected ?? false}
            detail="Gen-4 Turbo · Video generation"
          />
        </div>

        <h3 className="text-xs font-bold text-[#0F172A] mb-2">Platform Channels</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {platformConnections.map((c) => (
            <div key={c.platform} className="flex items-center gap-2 p-3 rounded-xl border border-[#E2E8F0]">
              <span className="text-al-primary">{platformIcon(c.platform, 16)}</span>
              <div>
                <p className="text-xs font-semibold capitalize text-[#0F172A]">{c.platform}</p>
                <p className={`text-[10px] font-bold ${c.connected ? "text-emerald-600" : "text-[#94A3B8]"}`}>{c.connected ? "Connected" : "Not connected"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ icon, name, connected, detail }: { icon: ReactNode; name: string; connected: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0]">
      <span className="text-al-primary">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#0F172A]">{name}</p>
        <p className={`text-[10px] font-bold ${connected ? "text-emerald-600" : "text-[#94A3B8]"}`}>
          {connected ? `✅ Connected · ${detail}` : "Not connected"}
        </p>
      </div>
    </div>
  );
}

// ─── Tab 7: Market Index ─────────────────────────────────────────────────────

export default SettingsTab;
