// AutoLenis Social Engine — Buffer publishing provider (GraphQL API).
//
// Buffer retired the old v1 REST API (api.bufferapp.com/1). This provider
// targets the new GraphQL API at https://api.buffer.com. Authentication is a
// Bearer token (BUFFER_API_KEY). One Buffer channel id per platform, env-driven.
//
// All methods are defensive: they log start + result, never throw unhandled
// errors, return typed results, and degrade gracefully when a channel id is
// not configured.

import type {
  PublishingProvider,
  SchedulePostInput,
  PublishPostInput,
  PublishResult,
  PostStatusResult,
  PostAnalyticsResult,
} from "@/lib/social/providers/publishing.provider";

const BUFFER_GRAPHQL_URL = "https://api.buffer.com";

// One Buffer channel id per platform, read from the environment. Empty string
// when unconfigured so callers can skip gracefully.
function channelIdMap(): Record<string, string> {
  return {
    facebook: process.env.BUFFER_PROFILE_FACEBOOK ?? "",
    instagram: process.env.BUFFER_PROFILE_INSTAGRAM ?? "",
    tiktok: process.env.BUFFER_PROFILE_TIKTOK ?? "",
    youtube: process.env.BUFFER_PROFILE_YOUTUBE ?? "",
    linkedin: process.env.BUFFER_PROFILE_LINKEDIN ?? "",
  };
}

function channelIdFor(platform: string): string {
  return channelIdMap()[platform.toLowerCase()] ?? "";
}

function composeText(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}

// Executes a GraphQL request against the Buffer API. Throws with the full error
// message from the response body so callers can log it; callers wrap this in
// try/catch and translate to typed results.
async function bufferGraphQL(
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.BUFFER_API_KEY ?? "";
  const res = await fetch(BUFFER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text().catch(() => "");
  let json: { data?: unknown; errors?: Array<{ message?: string }> } | undefined;
  try {
    json = text ? (JSON.parse(text) as typeof json) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const detail = json?.errors?.map((e) => e.message).join("; ") || text.slice(0, 300);
    throw new Error(`Buffer GraphQL HTTP ${res.status}: ${detail}`);
  }
  if (json?.errors && json.errors.length > 0) {
    throw new Error(`Buffer GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json?.data;
}

// GraphQL documents ----------------------------------------------------------

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on Post {
        id
        status
        scheduledAt
      }
      ... on CoreError {
        message
        type
      }
    }
  }
`;

const GET_POST_QUERY = `
  query GetPost($id: String!) {
    post(id: $id) {
      id
      status
      statistics {
        impressions
        clicks
        likes
        comments
        shares
        reach
      }
    }
  }
`;

interface CreatePostResult {
  createPost?: {
    id?: string;
    status?: string;
    scheduledAt?: string;
    message?: string; // CoreError
    type?: string; // CoreError
  };
}

interface PostStatistics {
  impressions?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
}

interface GetPostResult {
  post?: {
    id?: string;
    status?: string;
    scheduledAt?: string;
    publishedAt?: string;
    statistics?: PostStatistics;
  };
}

export class BufferProvider implements PublishingProvider {
  readonly name = "buffer";

  // Shared create path for both schedule + publish-now. `scheduledAt` is always
  // an ISO string Buffer should target.
  private async createPost(
    input: SchedulePostInput | PublishPostInput,
    scheduledAtIso: string,
  ): Promise<PublishResult> {
    const channelId = channelIdFor(input.platform);
    console.log(
      `[publish:buffer] createPost platform=${input.platform} channel=${channelId ? "set" : "missing"} at=${scheduledAtIso}`,
    );

    if (!process.env.BUFFER_API_KEY) {
      return { success: false, error: "BUFFER_API_KEY not configured", provider: this.name };
    }
    if (!channelId) {
      // Skip gracefully when no channel id is configured for this platform.
      return {
        success: false,
        error: `No Buffer channel configured for platform ${input.platform}`,
        provider: this.name,
      };
    }

    // Attach the best available media: a video (with a poster thumbnail when we
    // have one) takes priority, otherwise the still image.
    const videoUrl = input.videoUrl ?? (input.isVideo ? input.mediaUrl : undefined);
    const imageUrl = input.imageUrl ?? input.thumbnailUrl ?? (!input.isVideo ? input.mediaUrl : undefined);

    const media: Array<{ url: string; type: string; thumbnailUrl?: string }> = [];
    if (videoUrl) {
      media.push({
        url: videoUrl,
        type: "video",
        thumbnailUrl: input.thumbnailUrl ?? imageUrl ?? videoUrl,
      });
    } else if (imageUrl) {
      media.push({ url: imageUrl, type: "image" });
    }

    try {
      const data = (await bufferGraphQL(CREATE_POST_MUTATION, {
        input: {
          channelId,
          text: composeText(input.caption, input.hashtags),
          scheduledAt: scheduledAtIso,
          media: media.length > 0 ? media : undefined,
        },
      })) as CreatePostResult;

      const result = data?.createPost;
      if (!result) {
        return { success: false, error: "Buffer returned no createPost payload", provider: this.name };
      }
      // CoreError variant carries a message but no id.
      if (result.message && !result.id) {
        console.error(`[publish:buffer] CoreError: ${result.type ?? ""} ${result.message}`);
        return { success: false, error: result.message, provider: this.name };
      }
      if (!result.id) {
        return { success: false, error: "Buffer response missing post id", provider: this.name };
      }
      console.log(`[publish:buffer] created post id=${result.id} status=${result.status ?? "?"}`);
      return { success: true, platformPostId: result.id, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:buffer] createPost failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    return this.createPost(input, input.scheduledAt.toISOString());
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    return this.createPost(input, new Date().toISOString());
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    console.log(`[publish:buffer] getPostStatus id=${platformPostId}`);
    if (!process.env.BUFFER_API_KEY) {
      return { platformPostId, status: "unknown", error: "BUFFER_API_KEY not configured" };
    }
    try {
      const data = (await bufferGraphQL(GET_POST_QUERY, { id: platformPostId })) as GetPostResult;
      const post = data?.post;
      if (!post) {
        return { platformPostId, status: "unknown", error: "Buffer returned no post" };
      }
      return {
        platformPostId,
        status: post.status ?? "unknown",
        publishedAt: post.publishedAt ?? undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:buffer] getPostStatus failed: ${message}`);
      return { platformPostId, status: "unknown", error: message };
    }
  }

  async getAnalytics(platformPostId: string): Promise<PostAnalyticsResult> {
    console.log(`[publish:buffer] getAnalytics id=${platformPostId}`);
    if (!process.env.BUFFER_API_KEY) {
      return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: "BUFFER_API_KEY not configured" };
    }
    try {
      const data = (await bufferGraphQL(GET_POST_QUERY, { id: platformPostId })) as GetPostResult;
      const stats = data?.post?.statistics ?? {};
      return {
        likes: stats.likes ?? 0,
        comments: stats.comments ?? 0,
        shares: stats.shares ?? 0,
        clicks: stats.clicks ?? 0,
        reach: stats.reach ?? 0,
        impressions: stats.impressions,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:buffer] getAnalytics failed: ${message}`);
      return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: message };
    }
  }
}
