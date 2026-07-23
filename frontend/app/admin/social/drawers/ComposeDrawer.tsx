"use client";
// Compose drawer — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X, AlertTriangle, Check, Loader2, Wand2, Zap, Shield, ImageIcon, ChevronDown } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { platformIcon } from "../_shared/ui";
import type { FranchiseRow } from "../_shared/types";

const COMPOSE_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "linkedin"] as const;

function defaultScheduleAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function ComposeDrawer({
  franchises, onClose, onCreated, showToast,
}: {
  franchises: FranchiseRow[];
  onClose: () => void;
  onCreated: () => void;
  showToast: (m: string) => void;
}) {
  // ── Cross-platform targeting ───────────────────────────────────────────
  const [targetPlatforms, setTargetPlatforms] = useState<string[]>(["tiktok"]);
  // Primary platform drives AI generation + image sizing.
  const platform = targetPlatforms[0] ?? "tiktok";

  // ── Core fields ────────────────────────────────────────────────────────
  const [franchiseSlug, setFranchiseSlug] = useState<string>(
    franchises[0]?.slug ?? "dealer_secret_daily",
  );
  const [topic, setTopic] = useState("");
  const [personality, setPersonality] = useState("buyer_advocate");
  const [hook, setHook] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleAt());
  const [useRecommendedTime, setUseRecommendedTime] = useState(true);
  const [recommendedTime, setRecommendedTime] = useState("");
  // Real optimal posting instant (ISO) from the learned PostingWindow, returned
  // by ai-generate. Used to actually schedule when "Use AI recommendation" is on.
  const [recommendedIso, setRecommendedIso] = useState("");

  // ── AI generation state ────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [videoScript, setVideoScript] = useState<Record<string, string> | null>(null);
  const [imageBrief, setImageBrief] = useState("");
  const [showVideoScript, setShowVideoScript] = useState(false);

  // ── Quality score state ────────────────────────────────────────────────
  const [qualityScore, setQualityScore] = useState<{
    total: number;
    hookStrength: number;
    specificity: number;
    ctaClarity: number;
    compliance: number;
    needsRegeneration: boolean;
    isPriority: boolean;
    reasons: string[];
  } | null>(null);
  const [improving, setImproving] = useState(false);

  // ── Image preview state ────────────────────────────────────────────────
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageVariants, setImageVariants] = useState<string[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);

  // Upload a user-provided image; the returned hosted URL becomes the preview
  // and is attached to the post on submit.
  const handleUploadImage = useCallback(
    async (file: File) => {
      setUploadingImage(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetchJson<{ imageUrl: string }>(
          "/api/admin/social/compose/upload-image",
          { method: "POST", body: fd },
        );
        setPreviewImage(res.imageUrl);
        setImageVariants([]);
        showToast("Image uploaded");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Image upload failed");
      } finally {
        setUploadingImage(false);
      }
    },
    [showToast],
  );

  // ── Compliance state ───────────────────────────────────────────────────
  const [complianceOk, setComplianceOk] = useState<boolean | null>(null);

  // ── Submission state ───────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);

  // ── Trending tags ──────────────────────────────────────────────────────
  const [trendingTags, setTrendingTags] = useState<string[]>([]);
  useEffect(() => {
    fetchJson<{ trending: { tiktokHashtags?: string[] } | null }>(
      "/api/admin/social/trending",
    )
      .then((d) => {
        setTrendingTags(d.trending?.tiktokHashtags?.slice(0, 5) ?? []);
      })
      .catch(() => {});
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────
  const scoreColor = (score: number) =>
    score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-500";

  const scoreBg = (score: number) =>
    score >= 80
      ? "bg-emerald-50 border-emerald-200"
      : score >= 60
        ? "bg-amber-50 border-amber-200"
        : "bg-red-50 border-red-200";

  const togglePlatform = (p: string) => {
    setTargetPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const addTrendingTag = (tag: string) => {
    const current = hashtags.split(",").map((h) => h.trim()).filter(Boolean);
    if (!current.includes(tag)) {
      setHashtags([...current, tag].join(", "));
    }
  };

  // ── Generate Image ─────────────────────────────────────────────────────
  const handleGenerateImage = useCallback(
    async (brief?: string) => {
      const briefToUse = brief ?? imageBrief;
      if (!briefToUse) {
        showToast("Generate content first to get an image brief");
        return;
      }
      setGeneratingImage(true);
      try {
        const res = await fetchJson<{ imageUrl: string }>(
          "/api/admin/social/compose/generate-preview-image",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBrief: briefToUse, platform }),
          },
        );
        setPreviewImage(res.imageUrl);
        setImageVariants((prev) => [res.imageUrl, ...prev].slice(0, 3));
        setSelectedImageIdx(0);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Image generation failed");
      } finally {
        setGeneratingImage(false);
      }
    },
    [imageBrief, platform, showToast],
  );

  // ── AI Generate ────────────────────────────────────────────────────────
  const handleAIGenerate = async () => {
    setGenerating(true);
    setQualityScore(null);
    setPreviewImage(null);
    setVideoScript(null);
    setComplianceOk(null);
    try {
      const res = await fetchJson<{
        hook: string;
        caption: string;
        hashtags: string[];
        hookType: string;
        videoScript?: Record<string, string>;
        imageBrief: string;
        scheduleSuggestion: string;
        recommendedScheduleIso?: string | null;
        qualityScore: {
          total: number;
          hookStrength: number;
          specificity: number;
          ctaClarity: number;
          compliance: number;
          needsRegeneration: boolean;
          isPriority: boolean;
          reasons: string[];
        };
      }>("/api/admin/social/compose/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          franchiseSlug,
          topic: topic.trim() || undefined,
          personality,
          includeVideoScript: true,
        }),
      });

      setHook(res.hook ?? "");
      setCaption(res.caption ?? "");
      setHashtags((res.hashtags ?? []).join(", "));
      setVideoScript(res.videoScript ?? null);
      setImageBrief(res.imageBrief ?? "");
      setQualityScore(res.qualityScore);
      setComplianceOk((res.qualityScore?.compliance ?? 0) > 0);

      if (res.scheduleSuggestion) {
        setRecommendedTime(res.scheduleSuggestion);
      }
      setRecommendedIso(res.recommendedScheduleIso ?? "");

      // Auto-generate image preview
      if (res.imageBrief) {
        void handleGenerateImage(res.imageBrief);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setGenerating(false);
    }
  };

  // ── Auto-Improve ───────────────────────────────────────────────────────
  const handleAutoImprove = async () => {
    if (!qualityScore) return;
    setImproving(true);
    try {
      const improveTopic =
        `IMPROVE THIS CONTENT (scored ${qualityScore.total}/100): ` +
        `Current hook: "${hook}". Issues: ${qualityScore.reasons.join(", ")}. ` +
        `Current caption: "${caption.slice(0, 100)}". ` +
        `Fix the specific issues and make it score above 80.`;

      const res = await fetchJson<{
        hook: string;
        caption: string;
        hashtags: string[];
        videoScript?: Record<string, string>;
        imageBrief: string;
        qualityScore: typeof qualityScore;
      }>("/api/admin/social/compose/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          franchiseSlug,
          topic: improveTopic,
          personality,
          includeVideoScript: true,
        }),
      });

      setHook(res.hook ?? hook);
      setCaption(res.caption ?? caption);
      setHashtags((res.hashtags ?? []).join(", "));
      setVideoScript(res.videoScript ?? null);
      setQualityScore(res.qualityScore);
      if (res.imageBrief) {
        setImageBrief(res.imageBrief);
        void handleGenerateImage(res.imageBrief);
      }
    } catch {
      showToast("Auto-improve failed");
    } finally {
      setImproving(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!hook.trim() || !caption.trim()) {
      showToast("Hook and caption are required");
      return;
    }
    if (complianceOk === false) {
      showToast("Fix compliance issues before publishing");
      return;
    }
    setSaving(true);
    try {
      const platforms = targetPlatforms.length > 0 ? targetPlatforms : [platform];

      for (const p of platforms) {
        await fetchJson("/api/admin/social/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: p,
            franchiseSlug,
            hook,
            caption,
            hashtags: hashtags.split(",").map((h) => h.trim()).filter(Boolean),
            // When "Use AI recommendation" is on, schedule to the real optimal
            // instant from the learned PostingWindow (recommendedIso); fall back
            // to the default only when no recommendation was returned.
            scheduledAt: useRecommendedTime
              ? new Date(recommendedIso || defaultScheduleAt()).toISOString()
              : new Date(scheduledAt).toISOString(),
            // Attach the exact previewed/uploaded image when present; otherwise
            // let the server AI-generate one.
            imageUrl: previewImage ?? undefined,
            generateImage: !previewImage,
            videoScript,
          }),
        });
      }
      showToast(
        platforms.length > 1
          ? `${platforms.length} posts created across platforms`
          : "Post created and scheduled",
      );
      onCreated();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setSaving(false);
    }
  };

  const PERSONALITY_OPTIONS = [
    { value: "buyer_advocate", label: "🛡️ Buyer Advocate" },
    { value: "dealer_insider", label: "🎭 Dealer Insider" },
    { value: "market_analyst", label: "📊 Market Analyst" },
    { value: "negotiator", label: "⚡ The Negotiator" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="compose-drawer">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[620px] bg-white h-full overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Create Post</h2>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <Shield size={11} /> AI-powered content creation
            </p>
          </div>
          <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* Step 1: Platform targeting */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-2 block">
              Publish To
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMPOSE_PLATFORMS.map((p) => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    targetPlatforms.includes(p)
                      ? "bg-al-primary text-white"
                      : "bg-white border border-[#E2E8F0] text-[#64748B]"
                  }`}
                >
                  {platformIcon(p, 12)} {p}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Select multiple platforms to publish the same content everywhere at once
            </p>
          </div>

          {/* Step 2: Franchise + Voice */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
                Franchise
              </label>
              <select
                value={franchiseSlug}
                onChange={(e) => setFranchiseSlug(e.target.value)}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#0F172A]"
              >
                {franchises.map((f) => (
                  <option key={f.id} value={f.slug}>{f.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
                Brand Voice
              </label>
              <select
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#0F172A]"
              >
                {PERSONALITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Step 3: Topic + Generate */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
              Topic or Vehicle (optional)
            </label>
            <div className="flex gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Toyota Camry in Dallas, dealer doc fee, trade-in tips..."
                className="flex-1 text-xs border border-[#E2E8F0] rounded-lg p-2"
              />
              <button
                onClick={handleAIGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 bg-al-primary text-white text-xs
                  font-semibold px-4 py-2 rounded-lg hover:bg-[#0a54bc]
                  disabled:opacity-50 whitespace-nowrap"
              >
                {generating ? (
                  <><Loader2 size={12} className="animate-spin" /> Generating...</>
                ) : (
                  <><Wand2 size={12} /> ✨ Generate</>
                )}
              </button>
            </div>
          </div>

          {/* Trending tags */}
          {trendingTags.length > 0 && (
            <div>
              <p className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1">
                🔥 Trending Today
              </p>
              <div className="flex flex-wrap gap-1">
                {trendingTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => addTrendingTag(tag)}
                    className="text-[10px] bg-al-primary-subtle text-al-primary px-2 py-0.5
                      rounded-full border border-al-primary/20 hover:bg-[#DBEAFE]"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quality score */}
          {qualityScore && (
            <div className={`rounded-xl border p-3 ${scoreBg(qualityScore.total)}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {qualityScore.isPriority ? (
                    <span className="text-xs font-bold text-emerald-600">🔥 Priority Content</span>
                  ) : qualityScore.needsRegeneration ? (
                    <span className="text-xs font-bold text-red-500">⚠️ Needs Improvement</span>
                  ) : (
                    <span className="text-xs font-bold text-amber-600">✓ Good Content</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-lg font-bold ${scoreColor(qualityScore.total)}`}>
                    {qualityScore.total}
                  </span>
                  <span className="text-xs text-slate-400">/100</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1 mb-2">
                {[
                  { label: "Hook", score: qualityScore.hookStrength, max: 25 },
                  { label: "Specific", score: qualityScore.specificity, max: 25 },
                  { label: "CTA", score: qualityScore.ctaClarity, max: 25 },
                  { label: "Comply", score: qualityScore.compliance, max: 25 },
                ].map((item) => (
                  <div key={item.label} className="text-center">
                    <p className="text-[10px] text-slate-500">{item.label}</p>
                    <p className={`text-xs font-bold ${scoreColor((item.score / item.max) * 100)}`}>
                      {item.score}/{item.max}
                    </p>
                  </div>
                ))}
              </div>

              {qualityScore.reasons.length > 0 && (
                <div className="mb-2">
                  {qualityScore.reasons.slice(0, 2).map((r, i) => (
                    <p key={i} className="text-[10px] text-slate-600">⚠ {r}</p>
                  ))}
                </div>
              )}

              {qualityScore.needsRegeneration && (
                <button
                  onClick={handleAutoImprove}
                  disabled={improving}
                  className="w-full text-xs font-semibold bg-amber-500 text-white
                    py-1.5 rounded-lg hover:bg-amber-600 disabled:opacity-50
                    flex items-center justify-center gap-1"
                >
                  {improving ? (
                    <><Loader2 size={10} className="animate-spin" />Improving...</>
                  ) : (
                    <><Zap size={10} />Auto-Improve This Content</>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Hook field */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
              Hook *
            </label>
            <textarea
              value={hook}
              maxLength={100}
              onChange={(e) => setHook(e.target.value)}
              rows={2}
              placeholder="Your dealer just added $800 to your contract..."
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2"
              data-testid="compose-hook"
            />
            <p className="text-[10px] text-[#94A3B8] text-right mt-0.5">
              {hook.length}/100
            </p>
          </div>

          {/* Caption field */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
              Caption *
            </label>
            <textarea
              value={caption}
              maxLength={2200}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              placeholder="Write your caption here..."
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2"
              data-testid="compose-caption"
            />
            <p className="text-[10px] text-[#94A3B8] text-right mt-0.5">
              {caption.length}/2200
            </p>
          </div>

          {/* Hashtags */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-1 block">
              Hashtags
            </label>
            <input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#CarBuying, #DealerSecrets, #AutoLenis"
              className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2"
            />
          </div>

          {/* Video Script (collapsible) */}
          {videoScript && (
            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowVideoScript(!showVideoScript)}
                className="w-full flex items-center justify-between px-3 py-2
                  bg-[#F8FAFC] text-xs font-semibold text-[#0F172A]"
              >
                <span>🎬 Video Script</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${showVideoScript ? "rotate-180" : ""}`}
                />
              </button>
              {showVideoScript && (
                <div className="p-3 space-y-2">
                  {[
                    { key: "hook_0_3s", label: "Hook (0-3s)" },
                    { key: "beat1_3_10s", label: "Beat 1 (3-10s)" },
                    { key: "beat2_10_20s", label: "Beat 2 (10-20s)" },
                    { key: "beat3_20_25s", label: "Beat 3 (20-25s)" },
                    { key: "cta_25_30s", label: "CTA (25-30s)" },
                    { key: "onScreenText", label: "On-Screen Text" },
                  ].map(({ key, label }) =>
                    videoScript[key] ? (
                      <div key={key}>
                        <p className="text-[10px] font-semibold text-slate-500">{label}</p>
                        <p className="text-xs text-[#0F172A]">{videoScript[key]}</p>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          )}

          {/* Image Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase font-bold text-[#94A3B8]">
                Post Image
              </label>
              <div className="flex items-center gap-3">
                <label
                  className={`text-xs text-al-primary flex items-center gap-1 cursor-pointer
                    hover:underline ${uploadingImage ? "opacity-40 pointer-events-none" : ""}`}
                >
                  <ImageIcon size={10} />
                  {uploadingImage ? "Uploading..." : "Upload"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadImage(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={() => void handleGenerateImage()}
                  disabled={generatingImage || !imageBrief}
                  className="text-xs text-al-primary flex items-center gap-1
                    hover:underline disabled:opacity-40"
                >
                  <RefreshCw size={10} />
                  {generatingImage ? "Generating..." : "Generate"}
                </button>
              </div>
            </div>

            {generatingImage ? (
              <div className="w-full h-48 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]
                flex items-center justify-center">
                <div className="text-center">
                  <Loader2 size={24} className="animate-spin text-al-primary mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Generating image...</p>
                </div>
              </div>
            ) : previewImage ? (
              <div className="space-y-2">
                <img
                  src={previewImage}
                  alt="AI generated preview"
                  className="w-full rounded-xl border border-[#E2E8F0] object-cover"
                  style={{ maxHeight: 300 }}
                />
                {imageVariants.length > 1 && (
                  <div className="flex gap-2">
                    {imageVariants.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedImageIdx(i);
                          setPreviewImage(url);
                        }}
                        className={`w-12 h-12 rounded-lg overflow-hidden border-2
                          ${selectedImageIdx === i ? "border-al-primary" : "border-[#E2E8F0]"}`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                    <button
                      onClick={() => void handleGenerateImage()}
                      disabled={generatingImage}
                      className="w-12 h-12 rounded-lg border-2 border-dashed
                        border-[#E2E8F0] flex items-center justify-center
                        text-slate-400 hover:border-al-primary hover:text-al-primary"
                    >
                      +
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-slate-400">
                  This image will be attached to your post automatically
                </p>
              </div>
            ) : (
              <div
                onClick={() => imageBrief && void handleGenerateImage()}
                className="w-full h-32 bg-[#F8FAFC] rounded-xl border-2 border-dashed
                  border-[#E2E8F0] flex items-center justify-center cursor-pointer
                  hover:border-al-primary hover:bg-al-primary-subtle transition-colors"
              >
                <div className="text-center">
                  <ImageIcon size={24} className="text-slate-300 mx-auto mb-1" />
                  <p className="text-xs text-slate-400">
                    {imageBrief
                      ? "Click to generate preview image"
                      : "Generate content first to get an image"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Compliance check */}
          {complianceOk !== null && (
            <div className={`flex items-center gap-2 p-2 rounded-lg text-xs
              ${complianceOk
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-600 border border-red-200"}`}>
              {complianceOk ? (
                <><Check size={12} /> Compliance check passed — no guarantee language detected</>
              ) : (
                <><AlertTriangle size={12} /> Fix compliance issues before publishing</>
              )}
            </div>
          )}

          {/* Schedule */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[#94A3B8] mb-2 block">
              Schedule Time
            </label>
            {recommendedTime && (
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRecommendedTime}
                  onChange={(e) => setUseRecommendedTime(e.target.checked)}
                />
                <span className="text-xs text-[#0F172A]">
                  📅 Use AI recommendation: {recommendedTime}
                </span>
              </label>
            )}
            {(!useRecommendedTime || !recommendedTime) && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full text-xs border border-[#E2E8F0] rounded-lg p-2"
              />
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-5 py-3">
          {targetPlatforms.length > 1 && (
            <p className="text-xs text-al-primary mb-2 text-center">
              Publishing to {targetPlatforms.length} platforms simultaneously
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={saving || !hook.trim() || !caption.trim()}
              data-testid="compose-submit"
              onClick={submit}
              className="flex-1 bg-al-primary text-white text-sm font-semibold
                py-2.5 rounded-xl hover:bg-[#0a54bc] disabled:opacity-50"
            >
              {saving ? "Creating…" : `Create Post${targetPlatforms.length > 1 ? ` (${targetPlatforms.length} platforms)` : ""}`}
            </button>
            <button
              onClick={onClose}
              className="text-[#64748B] text-sm font-semibold px-4"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Post detail drawer ──────────────────────────────────────────────────────

export default ComposeDrawer;
