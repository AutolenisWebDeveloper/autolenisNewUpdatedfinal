"use client";
// Settings tab (+ provider card) — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useEffect, useState, type ReactNode } from "react";
import { Send, Linkedin, Video } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { platformIcon } from "../_shared/ui";
import type { AutomationMode, FranchiseRow, PlatformConnection, ProviderConnections, BufferTestResult } from "../_shared/types";

function SettingsTab({
  automationMode, franchises, platformConnections, videoEnabled, publishingEnabled, showToast,
}: {
  automationMode: AutomationMode;
  franchises: FranchiseRow[];
  platformConnections: PlatformConnection[];
  videoEnabled: boolean;
  publishingEnabled: boolean;
  showToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<AutomationMode>(automationMode);
  const [connections, setConnections] = useState<ProviderConnections | null>(null);
  const [bufferTest, setBufferTest] = useState<BufferTestResult | null>(null);
  const [testingBuffer, setTestingBuffer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<ProviderConnections>("/api/admin/social/connections")
      .then((c) => { if (!cancelled) setConnections(c); })
      .catch((err) => showToast(err instanceof Error ? err.message : "Failed to load connections"));
    return () => { cancelled = true; };
  }, [showToast]);

  const testBuffer = async () => {
    setTestingBuffer(true);
    setBufferTest(null);
    try {
      const res = await fetchJson<BufferTestResult>(
        "/api/admin/social/connections/buffer-test",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      setBufferTest(res);
      showToast(
        res.apiKeyValid
          ? `Buffer OK — ${res.channels.length} channel${res.channels.length === 1 ? "" : "s"} reachable`
          : res.error ?? "Buffer test failed",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Buffer test failed");
    } finally {
      setTestingBuffer(false);
    }
  };

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
          Video: {videoEnabled ? "enabled" : "disabled"} · Publishing: {publishingEnabled ? "enabled" : "disabled"}
        </p>
        <div className="grid sm:grid-cols-3 gap-2 mb-4" data-testid="provider-connections">
          <ProviderCard
            icon={<Send size={16} />}
            name="Buffer"
            connected={connections?.buffer.connected ?? false}
            detail={connections ? `${connections.buffer.channelCount} channel${connections.buffer.channelCount === 1 ? "" : "s"}` : "…"}
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

        {/* Live Buffer verification — confirms the API key works and that each
            configured BUFFER_PROFILE_* id maps to a real channel. */}
        <div className="mt-5 border-t border-[#E2E8F0] pt-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-bold text-[#0F172A]">Buffer Setup Check</h3>
              <p className="text-[10px] text-[#94A3B8]">
                Verifies the API key live and matches your channel ids against Buffer.
              </p>
            </div>
            <button
              data-testid="buffer-test"
              onClick={testBuffer}
              disabled={testingBuffer}
              className="text-xs bg-al-primary text-white px-3 py-1.5 rounded-lg hover:bg-[#0a54bc] disabled:opacity-50"
            >
              {testingBuffer ? "Testing…" : "Test Buffer Connection"}
            </button>
          </div>

          {bufferTest && (
            <div className="space-y-2" data-testid="buffer-test-result">
              <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                <span className={`px-2 py-0.5 rounded-full ${bufferTest.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  Publishing {bufferTest.enabled ? "enabled" : "disabled (set ENABLE_BUFFER_PUBLISHING=true)"}
                </span>
                <span className={`px-2 py-0.5 rounded-full ${bufferTest.apiKeyPresent ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  API key {bufferTest.apiKeyPresent ? "present" : "missing"}
                </span>
                <span className={`px-2 py-0.5 rounded-full ${bufferTest.apiKeyValid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  API key {bufferTest.apiKeyValid ? "valid" : "invalid"}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {bufferTest.channels.length} channel{bufferTest.channels.length === 1 ? "" : "s"} reachable
                </span>
              </div>

              {bufferTest.error && (
                <p className="text-[10px] text-red-600">{bufferTest.error}</p>
              )}

              {bufferTest.apiKeyValid && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                  {bufferTest.configured.map((c) => {
                    // A platform is OK when its env id maps to a real channel OR
                    // a live channel was auto-resolved for it (no env id needed).
                    const ok = c.matched;
                    const tone = ok
                      ? "border-emerald-200 bg-emerald-50"
                      : c.present
                        ? "border-red-200 bg-red-50"
                        : "border-[#E2E8F0]";
                    return (
                      <div key={c.platform} className={`p-2 rounded-xl border ${tone}`}>
                        <p className="text-[10px] font-semibold capitalize text-[#0F172A]">{c.platform}</p>
                        <p className={`text-[10px] font-bold ${ok ? "text-emerald-600" : c.present ? "text-red-600" : "text-[#94A3B8]"}`}>
                          {c.matched
                            ? `✅ ${c.channelName || "matched"}${c.autoResolved ? " (auto)" : ""}`
                            : c.present
                              ? "⚠ id not found in Buffer"
                              : "No channel id set"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
