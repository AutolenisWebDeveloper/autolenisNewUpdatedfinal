"use client";
// A/B Tests tab — extracted from SocialDashboardClient.tsx as part of the
// social-dashboard decomposition (lazy-loaded by the shell). Behavior unchanged.
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../_shared/fetchJson";

// ─── Tab: A/B Tests ──────────────────────────────────────────────────────────
function ABTestsTab({ showToast }: { showToast: (m: string) => void }) {
  type ABVariant = {
    id: string; label: string; hookType: string; hook: string
    score: number; isWinner: boolean; postId: string
  };
  type ABGroup = {
    id: string; name: string; platform: string; franchiseSlug: string
    status: string; createdAt: string; completedAt?: string
    variants: ABVariant[]
  };

  const [groups, setGroups] = useState<ABGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPlatform, setNewPlatform] = useState("tiktok");
  const [newFranchise, setNewFranchise] = useState("dealer_secret_daily");
  const [newTopic, setNewTopic] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ groups: ABGroup[] }>(
        "/api/admin/social/ab-tests"
      );
      setGroups(data.groups);
    } catch { showToast("Failed to load A/B tests"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await fetchJson("/api/admin/social/ab-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: newPlatform,
          franchiseSlug: newFranchise,
          topic: newTopic.trim() || undefined,
        }),
      });
      showToast("A/B test created — 3 variants generating");
      void load();
    } catch { showToast("Failed to create A/B test"); }
    finally { setCreating(false); }
  };

  const handleResolve = async (groupId: string) => {
    setResolving(groupId);
    try {
      const res = await fetchJson<{ resolved: boolean; winnerHookType?: string }>(
        `/api/admin/social/ab-tests/${groupId}/resolve`,
        { method: "POST" }
      );
      if (res.resolved) {
        showToast(`Winner: ${res.winnerHookType ?? "resolved"}`);
        void load();
      } else {
        showToast("Not enough data yet — sync analytics first");
      }
    } catch { showToast("Resolution failed"); }
    finally { setResolving(null); }
  };

  const statusColor = (status: string) =>
    status === "COMPLETED" ? "text-emerald-600 bg-emerald-50"
    : status === "RUNNING" ? "text-al-primary bg-al-primary-subtle"
    : "text-slate-500 bg-slate-50";

  return (
    <div className="space-y-4">
      {/* Create new test */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
        <h3 className="text-sm font-bold text-[#0F172A] mb-3">
          Create New A/B Test
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Generates 3 hook variants for the same franchise.
          The system automatically detects the winner after 2-4 hours.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
              Platform
            </label>
            <select
              value={newPlatform}
              onChange={e => setNewPlatform(e.target.value)}
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2"
            >
              {["tiktok","instagram","facebook","youtube","linkedin"].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
              Franchise
            </label>
            <input
              value={newFranchise}
              onChange={e => setNewFranchise(e.target.value)}
              placeholder="dealer_secret_daily"
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2"
            />
          </div>
        </div>
        <input
          value={newTopic}
          onChange={e => setNewTopic(e.target.value)}
          placeholder="Topic (optional): Toyota Camry, dealer fees..."
          className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2 mb-3"
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full bg-[#643293] text-white text-xs font-semibold
            py-2 rounded-xl hover:bg-[#5a2883] disabled:opacity-50"
        >
          {creating ? "Creating 3 variants..." : "🧪 Create A/B Test (3 Variants)"}
        </button>
      </div>

      {/* Test groups list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#0F172A]">
            {groups.length} Test{groups.length !== 1 ? "s" : ""}
          </h3>
          <button
            onClick={() => void load()}
            className="text-xs text-al-primary hover:underline"
          >
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">Loading tests...</p>
        ) : groups.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 text-center">
            <p className="text-sm text-slate-500">No A/B tests yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Create your first test above
            </p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.id}
              className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5
                      rounded-full ${statusColor(group.status)}`}>
                      {group.status}
                    </span>
                    <span className="text-xs text-slate-400 capitalize">
                      {group.platform}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#0F172A]">
                    {group.name}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Created {new Date(group.createdAt).toLocaleDateString()}
                    {group.completedAt && (
                      <> · Resolved {new Date(group.completedAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                {group.status === "RUNNING" && (
                  <button
                    onClick={() => handleResolve(group.id)}
                    disabled={resolving === group.id}
                    className="text-xs border border-al-primary text-al-primary
                      px-2 py-1 rounded-lg hover:bg-al-primary/5 disabled:opacity-50"
                  >
                    {resolving === group.id ? "Resolving..." : "Resolve Now"}
                  </button>
                )}
              </div>

              {/* Variants */}
              <div className="space-y-2">
                {group.variants.map(variant => (
                  <div key={variant.id}
                    className={`p-2 rounded-lg border ${
                      variant.isWinner
                        ? "bg-emerald-50 border-emerald-200"
                        : "bg-[#F8FAFC] border-[#E2E8F0]"
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold w-5 h-5 rounded-full
                          flex items-center justify-center
                          ${variant.isWinner
                            ? "bg-emerald-500 text-white"
                            : "bg-slate-200 text-slate-600"
                          }`}>
                          {variant.label}
                        </span>
                        <span className="text-xs text-slate-500 capitalize">
                          {variant.hookType}
                        </span>
                        {variant.isWinner && (
                          <span className="text-[10px] text-emerald-600 font-bold">
                            🏆 WINNER
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-al-primary">
                        {variant.score.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-xs text-[#0F172A] line-clamp-2">
                      {variant.hook}
                    </p>
                  </div>
                ))}
              </div>

              {/* Score bar visualization */}
              {group.variants.some(v => v.score > 0) && (
                <div className="mt-3">
                  <p className="text-[10px] text-slate-400 mb-1">Score comparison</p>
                  {(() => {
                    const max = Math.max(...group.variants.map(v => v.score), 1);
                    return group.variants.map(v => (
                      <div key={v.id} className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold w-4">{v.label}</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full">
                          <div
                            className={`h-full rounded-full ${
                              v.isWinner ? "bg-emerald-500" : "bg-al-primary"
                            }`}
                            style={{ width: `${(v.score / max) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 w-8">
                          {v.score.toFixed(0)}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ABTestsTab;
