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
  mediaUrl?: string; // video or image URL
  scheduledAt: Date;
  isVideo?: boolean;
}

export interface PublishPostInput {
  postId: string;
  platform: string;
  caption: string;
  hashtags: string[];
  mediaUrl?: string;
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
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  reach: number;
  impressions?: number;
  views?: number;
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
    console.log(`[publish:noop] disabled — would schedule post ${input.postId} on ${input.platform}`);
    return { success: false, error: "publishing disabled", provider: this.name };
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    console.log(`[publish:noop] disabled — would publish post ${input.postId} on ${input.platform}`);
    return { success: false, error: "publishing disabled", provider: this.name };
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    return { platformPostId, status: "unknown", error: "publishing disabled" };
  }

  async getAnalytics(): Promise<PostAnalyticsResult> {
    return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: "publishing disabled" };
  }
}
