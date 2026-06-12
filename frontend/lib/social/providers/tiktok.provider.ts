// AutoLenis Social Engine — TikTok direct publishing (Content Posting API v2).
//
// Publishes videos to the AutoLenis TikTok account via the Content Posting API
// (PULL_FROM_URL). Used by the publishing factory for the `tiktok` platform
// when TIKTOK_ACCESS_TOKEN is configured; otherwise TikTok falls back to Buffer.
//
// TikTok's API is video-only — there is no text-only post surface — so a post
// without a video URL is skipped gracefully. Per-post analytics require a
// separate API approval, so getAnalytics() returns zeros best-effort.
//
// All methods are defensive: they log, never throw unhandled errors, return
// typed results, and degrade gracefully when the token is unset.

import type {
  PublishingProvider,
  SchedulePostInput,
  PublishPostInput,
  PublishResult,
  PostStatusResult,
  PostAnalyticsResult,
} from "@/lib/social/providers/publishing.provider";

const BASE_URL = "https://open.tiktokapis.com/v2";

export class TikTokProvider implements PublishingProvider {
  readonly name = "tiktok";

  private token(): string {
    return process.env.TIKTOK_ACCESS_TOKEN ?? "";
  }

  private async post(input: SchedulePostInput | PublishPostInput): Promise<PublishResult> {
    const token = this.token();
    if (!token) {
      return { success: false, error: "TIKTOK_ACCESS_TOKEN not configured", provider: this.name };
    }

    const videoUrl = input.videoUrl ?? (input.isVideo ? input.mediaUrl : undefined);
    if (!videoUrl) {
      console.log("[tiktok] no video — skipping (text-only not supported on TikTok API)");
      return { success: false, error: "TikTok requires a video — text-only not supported", provider: this.name };
    }

    try {
      const res = await fetch(`${BASE_URL}/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: input.caption.slice(0, 150),
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: videoUrl,
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string };
      };

      const publishId = data.data?.publish_id;
      // TikTok returns error.code "ok" on success.
      if (!res.ok || !publishId || (data.error?.code && data.error.code !== "ok")) {
        const detail = data.error?.message ?? `HTTP ${res.status}`;
        console.error(`[tiktok] publish init failed: ${detail}`);
        return { success: false, error: detail, provider: this.name };
      }

      console.log(`[tiktok] publish init ok publish_id=${publishId}`);
      return { success: true, platformPostId: publishId, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tiktok] publish failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    // TikTok's PULL_FROM_URL flow publishes on submission; there is no native
    // scheduling under the Content Posting API.
    return this.post(input);
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    return this.post(input);
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    const token = this.token();
    if (!token) {
      return { platformPostId, status: "unknown", error: "TIKTOK_ACCESS_TOKEN not configured" };
    }
    try {
      const res = await fetch(`${BASE_URL}/post/publish/status/fetch/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publish_id: platformPostId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { status?: string };
        error?: { message?: string };
      };
      if (!res.ok || data.error?.message) {
        return { platformPostId, status: "unknown", error: data.error?.message ?? `HTTP ${res.status}` };
      }
      // Map TikTok's status (e.g. PUBLISH_COMPLETE) to our format.
      const raw = data.data?.status ?? "unknown";
      const status = raw === "PUBLISH_COMPLETE" ? "PUBLISHED" : raw;
      return { platformPostId, status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platformPostId, status: "unknown", error: message };
    }
  }

  async getAnalytics(platformPostId: string): Promise<PostAnalyticsResult> {
    const zeros: PostAnalyticsResult = { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0 };
    const token = this.token();
    if (!token) {
      return { ...zeros, error: "TIKTOK_ACCESS_TOKEN not configured" };
    }

    try {
      const res = await fetch(`${BASE_URL}/video/query/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters: { video_ids: [platformPostId] },
          fields: [
            "id",
            "like_count",
            "comment_count",
            "share_count",
            "view_count",
            "reach",
            "average_time_watched",
            "full_video_watched_rate",
            "profile_deep_dive_count",
            "follow_count",
            "impression_sources",
          ],
        }),
      });

      if (res.status === 401) {
        console.error("[tiktok] getAnalytics 401 — token expired");
        return zeros;
      }
      if (res.status === 403) {
        console.error("[tiktok] getAnalytics 403 — insufficient scope");
        return zeros;
      }
      if (res.status === 404) {
        console.error("[tiktok] getAnalytics 404 — video not found (deleted?)");
        return zeros;
      }

      const data = (await res.json().catch(() => ({}))) as {
        data?: {
          videos?: Array<{
            id?: string;
            like_count?: number;
            comment_count?: number;
            share_count?: number;
            view_count?: number;
            reach?: number;
            average_time_watched?: number;
            full_video_watched_rate?: number;
            profile_deep_dive_count?: number;
            follow_count?: number;
          }>;
        };
        error?: { code?: string; message?: string };
      };

      if (!res.ok || (data.error?.code && data.error.code !== "ok")) {
        console.error(`[tiktok] getAnalytics failed: ${data.error?.message ?? `HTTP ${res.status}`}`);
        return zeros;
      }

      const video = data.data?.videos?.[0];
      if (!video) return zeros;

      const likes = video.like_count ?? 0;
      const comments = video.comment_count ?? 0;
      const shares = video.share_count ?? 0;
      const views = video.view_count ?? 0;
      const reach = video.reach ?? views;

      // TODO: Add audience demographics
      // when TikTok Research API access is granted

      return {
        likes,
        comments,
        shares,
        clicks: 0,
        reach,
        views,
        watchTimeSeconds: video.average_time_watched,
        completionRate: video.full_video_watched_rate,
        profileVisits: video.profile_deep_dive_count,
        follows: video.follow_count,
        engagementRate: views > 0 ? (likes + comments + shares) / views : undefined,
      };
    } catch (err) {
      console.error("[tiktok] getAnalytics failed (non-fatal):", err);
      return zeros;
    }
  }
}
