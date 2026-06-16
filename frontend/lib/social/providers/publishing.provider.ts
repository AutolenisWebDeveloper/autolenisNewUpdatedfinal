import { logger } from "@/lib/logger";
// AutoLenis Social Engine — Publishing provider contract.
//
// Provider-agnostic interface for scheduling/publishing social posts and
// reading back status + analytics, plus a no-op implementation used when
// publishing is disabled or unconfigured.

export interface SchedulePostInput {
  postId: string;
  platform: string;
  caption: string;
  hashtags: string[];
  mediaUrl?: string; // primary video or image URL
  videoUrl?: string; // explicit video URL (preferred when present)
  imageUrl?: string; // generated still image URL
  thumbnailUrl?: string; // poster frame for a video
  trackedUrl?: string; // UTM-tagged destination — added as the first comment where links are suppressed
  scheduledAt: Date;
  isVideo?: boolean;
}

export interface PublishPostInput {
  postId: string;
  platform: string;
  caption: string;
  hashtags: string[];
  mediaUrl?: string;
  videoUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  trackedUrl?: string; // UTM-tagged destination — added as the first comment where links are suppressed
  isVideo?: boolean;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
  provider: string;
}

export interface PostStatusResult {
  platformPostId: string;
  status: string;
  publishedAt?: string;
  error?: string;
}

export interface PostAnalyticsResult {
  // Degradation contract: a metric the platform/endpoint does NOT return is
  // `null` (unavailable / unknown). Reserve `0` for a value the API confirmed is
  // zero. Downstream persistence stores null as null so the optimization loop
  // can exclude unknowns rather than averaging in fake zeros.
  // Core (all platforms)
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  reach: number | null;
  // Extended — optional per platform (null = confirmed-zero distinction applies)
  impressions?: number | null;
  views?: number | null;
  saves?: number | null; // Instagram, TikTok
  watchTimeSeconds?: number | null; // TikTok, YouTube
  completionRate?: number | null; // TikTok, YouTube (0-1)
  profileVisits?: number | null; // TikTok, Instagram
  follows?: number | null; // TikTok
  audienceCountries?: { country: string; pct: number }[]; // available on some
  audienceAgeRanges?: { range: string; pct: number }[]; // available on some
  audienceGenders?: { gender: string; pct: number }[]; // available on some
  engagementRate?: number | null; // computed: (likes+comments+shares)/reach
  error?: string;
}

export interface PublishingProvider {
  readonly name: string;
  schedulePost(input: SchedulePostInput): Promise<PublishResult>;
  publishNow(input: PublishPostInput): Promise<PublishResult>;
  getPostStatus(platformPostId: string): Promise<PostStatusResult>;
  getAnalytics(platformPostId: string): Promise<PostAnalyticsResult>;
}

// No-op provider — logs but never calls an external API. Selected when
// publishing is disabled or BUFFER_API_KEY is unset.
export class NoopPublishingProvider implements PublishingProvider {
  readonly name = "noop";

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    logger.info(`[publish:noop] disabled — would schedule post ${input.postId} on ${input.platform}`);
    return { success: false, error: "publishing disabled", provider: this.name };
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    logger.info(`[publish:noop] disabled — would publish post ${input.postId} on ${input.platform}`);
    return { success: false, error: "publishing disabled", provider: this.name };
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    return { platformPostId, status: "unknown", error: "publishing disabled" };
  }

  async getAnalytics(): Promise<PostAnalyticsResult> {
    return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: "publishing disabled" };
  }
}
