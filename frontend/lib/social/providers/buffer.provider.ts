// AutoLenis Social Engine — Buffer publishing provider (GraphQL API).
//
// Buffer retired the old v1 REST API (api.bufferapp.com/1). This provider
// targets the new GraphQL API at https://api.buffer.com. Authentication is a
// Bearer token (BUFFER_API_KEY). One Buffer channel id per platform, env-driven.
//
// All methods are defensive: they log start + result, never throw unhandled
// errors, return typed results, and degrade gracefully when a channel id is
// not configured.

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
  const res = await providerFetch(BUFFER_GRAPHQL_URL, {
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

// Buffer's createPost returns a PostActionPayload union of
// PostActionSuccess | MutationError. The post type exposes `dueAt` (there is no
// `scheduledAt` field), and the error variant is MutationError (not CoreError).
const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          dueAt
        }
      }
      ... on MutationError {
        message
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
    __typename?: string;
    post?: { id?: string; dueAt?: string }; // PostActionSuccess
    message?: string; // MutationError
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

  // Shared create path for both schedule + publish-now.
  //   - customScheduled targets a specific ISO time (`dueAtIso`).
  //   - addToQueue lets Buffer slot the post into the channel's queue (no time).
  private async createPost(
    input: SchedulePostInput | PublishPostInput,
    mode: "customScheduled" | "addToQueue",
    dueAtIso?: string,
  ): Promise<PublishResult> {
    const channelId = channelIdFor(input.platform);
    logger.info(
      `[publish:buffer] createPost platform=${input.platform} channel=${channelId ? "set" : "missing"} mode=${mode}${dueAtIso ? ` at=${dueAtIso}` : ""}`,
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

    // Buffer's CreatePostInput requires schedulingType + mode. Only attach
    // dueAt when scheduling a specific time (customScheduled); addToQueue lets
    // Buffer pick the next queue slot.
    const postInput: Record<string, unknown> = {
      channelId,
      text: composeText(input.caption, input.hashtags),
      schedulingType: "automatic",
      mode,
      media: media.length > 0 ? media : undefined,
    };
    if (mode === "customScheduled" && dueAtIso) {
      postInput.dueAt = dueAtIso;
    }

    try {
      const data = (await bufferGraphQL(CREATE_POST_MUTATION, {
        input: postInput,
      })) as CreatePostResult;

      const result = data?.createPost;
      if (!result) {
        return { success: false, error: "Buffer returned no createPost payload", provider: this.name };
      }
      // MutationError variant carries a message but no post.
      if (result.message && !result.post) {
        logger.error(`[publish:buffer] MutationError: ${result.message}`);
        return { success: false, error: result.message, provider: this.name };
      }
      const platformPostId = result.post?.id;
      if (!platformPostId) {
        return { success: false, error: "Buffer response missing post id", provider: this.name };
      }
      logger.info(`[publish:buffer] created post id=${platformPostId} dueAt=${result.post?.dueAt ?? "?"}`);
      return { success: true, platformPostId, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[publish:buffer] createPost failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    // Schedule at the requested time via customScheduled + dueAt.
    return this.createPost(input, "customScheduled", input.scheduledAt.toISOString());
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    // Publish-now hands the post to Buffer's queue (addToQueue, no dueAt).
    return this.createPost(input, "addToQueue");
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    logger.info(`[publish:buffer] getPostStatus id=${platformPostId}`);
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
      logger.error(`[publish:buffer] getPostStatus failed: ${message}`);
      return { platformPostId, status: "unknown", error: message };
    }
  }

  async getAnalytics(platformPostId: string): Promise<PostAnalyticsResult> {
    logger.info(`[publish:buffer] getAnalytics id=${platformPostId}`);
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
      logger.error(`[publish:buffer] getAnalytics failed: ${message}`);
      return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: message };
    }
  }
}
