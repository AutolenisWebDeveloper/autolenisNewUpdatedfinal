// AutoLenis Social Engine — YouTube provider.
//
// Publishing has been RETIRED: it was previously delegated to Buffer (YouTube has
// no first-party publish surface wired up here), and Buffer is gone. The publish
// methods now fail EXPLICITLY (success:false) — no fabricated success, no
// third-party hand-off. Per the owner decision, no YouTube publish replacement is
// built. Analytics are UNAFFECTED and still read from the YouTube Data API v3
// (public stats via YOUTUBE_API_KEY) with optional richer watch-time + completion
// metrics from the YouTube Analytics API when an OAuth token (YOUTUBE_OAUTH_TOKEN)
// is present.
//
// Graceful degradation:
//   - YOUTUBE_API_KEY unset           → zeros
//   - YOUTUBE_API_KEY set             → basic stats (views, likes, comments…)
//   - + YOUTUBE_OAUTH_TOKEN set       → full stats (watch time, completion rate)
//
// All methods are defensive: they log, never throw unhandled errors, return
// typed results, and degrade gracefully when config is missing.

import { logger } from "@/lib/logger";
import { providerFetch } from "@/lib/social/providers/http";
import type {
  PublishingProvider,
  SchedulePostInput,
  PublishPostInput,
  PublishResult,
  PostStatusResult,
  PostAnalyticsResult,
} from "@/lib/social/providers/publishing.provider";

// YouTube auto-publishing was Buffer-only and has been retired. Every publish
// path returns this explicit failure so a caller never mistakes it for success.
const PUBLISH_RETIRED =
  "YouTube publishing has been retired (was Buffer-only); no direct YouTube publish surface is configured";

const YOUTUBE_DATA_API = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

// Parse an ISO 8601 duration (e.g. PT1M30S) into whole seconds.
function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h ?? 0) * 3600) + (Number(m ?? 0) * 60) + Number(s ?? 0);
}

export class YouTubeProvider implements PublishingProvider {
  readonly name = "youtube";

  // Publishing retired with Buffer — fail explicitly (never fabricate success).
  async schedulePost(_input: SchedulePostInput): Promise<PublishResult> {
    return { success: false, error: PUBLISH_RETIRED, provider: this.name };
  }

  async publishNow(_input: PublishPostInput): Promise<PublishResult> {
    return { success: false, error: PUBLISH_RETIRED, provider: this.name };
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    return { platformPostId, status: "unknown", error: PUBLISH_RETIRED };
  }

  async getAnalytics(videoId: string): Promise<PostAnalyticsResult> {
    // Unavailable → null (never a fabricated 0).
    const unknown: PostAnalyticsResult = {
      likes: null,
      comments: null,
      shares: null,
      clicks: null,
      reach: null,
    };
    const apiKey = process.env.YOUTUBE_API_KEY ?? "";
    if (!apiKey) {
      return { ...unknown, error: "YOUTUBE_API_KEY not configured" };
    }

    try {
      const res = await providerFetch(
        `${YOUTUBE_DATA_API}?part=statistics,contentDetails&id=${videoId}&key=${apiKey}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        items?: Array<{
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
            favoriteCount?: string;
          };
          contentDetails?: { duration?: string };
        }>;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.items?.length) {
        if (data.error) logger.error(`[youtube] getAnalytics: ${data.error.message}`);
        return unknown;
      }

      const item = data.items[0];
      const stats = item.statistics ?? {};
      const views = Number(stats.viewCount ?? 0);
      const likes = Number(stats.likeCount ?? 0);
      const comments = Number(stats.commentCount ?? 0);
      const saves = Number(stats.favoriteCount ?? 0);
      const durationSeconds = parseIso8601Duration(item.contentDetails?.duration ?? "");

      const base: PostAnalyticsResult = {
        likes,
        comments,
        shares: null, // not available via Data API (filled by OAuth path if set)
        clicks: null, // not available via Data API
        reach: views, // YouTube reach ≈ views for Shorts (documented approximation)
        views,
        impressions: null, // Data API exposes no impressions metric
        saves,
        engagementRate: views > 0 ? (likes + comments) / views : null,
      };

      // Richer watch-time + completion metrics require OAuth (Analytics API).
      const oauth = process.env.YOUTUBE_OAUTH_TOKEN ?? "";
      if (oauth) {
        const extra = await this.getOAuthAnalytics(videoId, oauth, durationSeconds);
        return { ...base, ...extra };
      }

      return base;
    } catch (err) {
      logger.error("[youtube] getAnalytics failed (non-fatal):", err);
      return unknown;
    }
  }

  // YouTube Analytics API (OAuth) — adds watch time + completion rate. Only
  // called when YOUTUBE_OAUTH_TOKEN is set. Non-fatal on any failure.
  private async getOAuthAnalytics(
    videoId: string,
    oauthToken: string,
    durationSeconds: number,
  ): Promise<Partial<PostAnalyticsResult>> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const metrics = [
        "estimatedMinutesWatched",
        "averageViewDuration",
        "views",
        "likes",
        "comments",
        "shares",
        "subscribersGained",
      ].join(",");
      const url =
        `${YOUTUBE_ANALYTICS_API}?ids=channel==MINE&startDate=2024-01-01&endDate=${today}` +
        `&metrics=${metrics}&filters=video==${videoId}`;
      const res = await providerFetch(url, {
        headers: { Authorization: `Bearer ${oauthToken}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        columnHeaders?: Array<{ name?: string }>;
        rows?: Array<Array<number>>;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.rows?.length) {
        if (data.error) logger.error(`[youtube] analytics API: ${data.error.message}`);
        return {};
      }
      const headers = data.columnHeaders?.map((h) => h.name) ?? [];
      const row = data.rows[0];
      const value = (name: string): number => {
        const idx = headers.indexOf(name);
        return idx >= 0 ? Number(row[idx] ?? 0) : 0;
      };

      const avgViewDuration = value("averageViewDuration"); // seconds
      const shares = value("shares");

      return {
        shares,
        watchTimeSeconds: avgViewDuration,
        completionRate:
          durationSeconds > 0 ? Math.min(avgViewDuration / durationSeconds, 1) : undefined,
        follows: value("subscribersGained"),
      };
    } catch (err) {
      logger.error("[youtube] OAuth analytics failed (non-fatal):", err);
      return {};
    }
  }
}
