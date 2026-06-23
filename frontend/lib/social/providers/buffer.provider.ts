// AutoLenis Social Engine — Buffer publishing provider (GraphQL API).
//
// Buffer retired the old v1 REST API (api.bufferapp.com/1). This provider
// targets the current public GraphQL API at https://api.buffer.com.
// Authentication is a personal API key passed as a Bearer token (BUFFER_API_KEY).
//
// Every query/mutation in this file is validated against the live Buffer GraphQL
// schema (see introspect). The important shapes:
//   • createPost(input: CreatePostInput!) where media goes in `assets`
//     ([AssetInput!] — a @oneOf of { image } | { video } | { document } | { link })
//     and the publish behaviour is selected via `mode: ShareMode`
//     (shareNow | customScheduled | addToQueue) + `schedulingType` (automatic).
//   • post(input: PostInput!) returns a Post whose analytics live on
//     `metrics: [PostMetric!]` ({ type, value }) and whose sent time is `sentAt`
//     (there is NO `statistics` block and NO `publishedAt` field).
//   • posts(input: PostsInput!, first, after) returns a Relay connection used to
//     retrieve published / scheduled / draft / queued / historical posts.
//
// All methods are defensive: they log start + result, never throw unhandled
// errors, return typed results, and degrade gracefully when a channel id /
// organization id is not configured.

import { logger } from "@/lib/logger";
import { getPlatformConfig } from "@/lib/social/config";
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

// Buffer's `service` values for each platform we publish to. Buffer keys
// channels by service, which lets us auto-resolve a channel id from the live
// account when the explicit BUFFER_PROFILE_* env var is not set.
const PLATFORM_SERVICE: Record<string, string> = {
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
  linkedin: "linkedin",
  twitter: "twitter",
  x: "twitter",
};

// One Buffer channel id per platform, read from the environment. Empty string
// when unconfigured so callers can fall back to live resolution.
function channelIdMap(): Record<string, string> {
  return {
    facebook: process.env.BUFFER_PROFILE_FACEBOOK ?? "",
    instagram: process.env.BUFFER_PROFILE_INSTAGRAM ?? "",
    tiktok: process.env.BUFFER_PROFILE_TIKTOK ?? "",
    youtube: process.env.BUFFER_PROFILE_YOUTUBE ?? "",
    linkedin: process.env.BUFFER_PROFILE_LINKEDIN ?? "",
  };
}

function configuredChannelIdFor(platform: string): string {
  return channelIdMap()[platform.toLowerCase()] ?? "";
}

function composeText(caption: string, hashtags: string[], trackedUrl?: string, platform?: string): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  let text = tags ? `${caption}\n\n${tags}` : caption;
  // Append the tracked destination URL inline for platforms that render clickable
  // links in the caption. Instagram suppresses caption links, so it is omitted
  // there (the link belongs in bio / first comment for that surface).
  if (trackedUrl && platform && getPlatformConfig(platform).linkInCaption) {
    text = `${text}\n\n${trackedUrl}`;
  }
  return text;
}

// Executes a GraphQL request against the Buffer API. Throws with the full error
// message from the response body so callers can log it; callers wrap this in
// try/catch and translate to typed results. Distinguishes HTTP 429 so callers
// can surface rate-limit pressure.
export class BufferRateLimitError extends Error {}

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

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new BufferRateLimitError(
      `Buffer rate limit (HTTP 429)${retryAfter ? `, retry after ${retryAfter}s` : ""}`,
    );
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

// ── GraphQL documents ────────────────────────────────────────────────────────

// createPost returns a PostActionPayload union of PostActionSuccess plus the
// concrete error types (all implement the MutationError interface). The inline
// fragment on the interface captures `message` for every error variant.
const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          dueAt
          sentAt
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          dueAt
          sentAt
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      __typename
      ... on DeletePostSuccess {
        id
      }
      ... on VoidMutationError {
        message
      }
    }
  }
`;

// Verifies the API key by resolving the authenticated account's organizations.
const ACCOUNT_QUERY = `
  query GetAccount {
    account {
      organizations {
        id
        name
      }
    }
  }
`;

// Lists the channels (connected social profiles) for an organization. The
// organizationId is inlined (it comes from Buffer's own account response, so it
// is trusted) to avoid depending on the exact name of the input variable type.
function channelsQuery(organizationId: string): string {
  return `
    query GetChannels {
      channels(input: { organizationId: ${JSON.stringify(organizationId)} }) {
        id
        name
        service
        isDisconnected
        isLocked
      }
    }
  `;
}

// Single post — status + metrics. Post.metrics is [PostMetric!] ({type,value});
// the sent time is `sentAt` (there is no publishedAt). PostId is a custom scalar.
const GET_POST_QUERY = `
  query GetPost($id: PostId!) {
    post(input: { id: $id }) {
      id
      status
      dueAt
      sentAt
      metricsUpdatedAt
      metrics {
        type
        value
      }
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────────────

interface CreatePostResult {
  createPost?: {
    __typename?: string;
    post?: { id?: string; status?: string; dueAt?: string; sentAt?: string };
    message?: string; // MutationError variants
  };
}
interface EditPostResult {
  editPost?: {
    __typename?: string;
    post?: { id?: string; status?: string; dueAt?: string; sentAt?: string };
    message?: string;
  };
}
interface DeletePostResult {
  deletePost?: { __typename?: string; id?: string; message?: string };
}

interface BufferMetric {
  type?: string;
  value?: number;
}
interface GetPostResult {
  post?: {
    id?: string;
    status?: string;
    dueAt?: string;
    sentAt?: string;
    metricsUpdatedAt?: string;
    metrics?: BufferMetric[] | null;
  };
}

// ── Organization + channel resolution (cached) ───────────────────────────────

interface CachedChannels {
  organizationId: string;
  channels: BufferChannel[];
  fetchedAt: number;
}
let channelCache: CachedChannels | null = null;
const CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;

// Resolves the organization id: explicit env wins, otherwise the first org the
// API key can see. Returns "" when nothing is resolvable.
async function resolveOrganizationId(): Promise<string> {
  const envOrg = process.env.BUFFER_ORGANIZATION_ID?.trim();
  if (envOrg) return envOrg;
  try {
    const acct = (await bufferGraphQL(ACCOUNT_QUERY)) as AccountQueryResult;
    return acct?.account?.organizations?.find((o) => o?.id)?.id ?? "";
  } catch (err) {
    logger.error("[publish:buffer] resolveOrganizationId failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

// Loads (and caches) the live channels for the resolved organization.
async function loadChannels(force = false): Promise<CachedChannels | null> {
  if (!force && channelCache && Date.now() - channelCache.fetchedAt < CHANNEL_CACHE_TTL_MS) {
    return channelCache;
  }
  const organizationId = await resolveOrganizationId();
  if (!organizationId) return null;
  try {
    const data = (await bufferGraphQL(channelsQuery(organizationId))) as ChannelsQueryResult;
    const channels: BufferChannel[] = [];
    for (const c of data?.channels ?? []) {
      if (!c?.id) continue;
      channels.push({
        id: c.id,
        name: c.name ?? "",
        service: c.service ?? "",
        isDisconnected: Boolean(c.isDisconnected),
        isLocked: Boolean(c.isLocked),
      });
    }
    channelCache = { organizationId, channels, fetchedAt: Date.now() };
    return channelCache;
  } catch (err) {
    logger.error("[publish:buffer] loadChannels failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Resolves a channel id for a platform: the explicit BUFFER_PROFILE_* env var
// wins; otherwise we match a live channel by Buffer `service`, preferring a
// connected, unlocked one. Returns "" when none is found.
async function resolveChannelId(platform: string): Promise<string> {
  const configured = configuredChannelIdFor(platform);
  if (configured) return configured;

  const service = PLATFORM_SERVICE[platform.toLowerCase()];
  if (!service) return "";
  const cache = await loadChannels();
  if (!cache) return "";
  const matches = cache.channels.filter((c) => c.service === service);
  const healthy = matches.find((c) => !c.isDisconnected && !c.isLocked);
  return (healthy ?? matches[0])?.id ?? "";
}

// Maps Buffer's PostMetricType values onto our PostAnalyticsResult fields.
function mapMetricsToAnalytics(metrics: BufferMetric[] | null | undefined): PostAnalyticsResult {
  // Start every core metric at null (unknown). Only metrics Buffer actually
  // returns overwrite a null, preserving the "null = unavailable, 0 = confirmed
  // zero" contract the optimization loop relies on.
  const out: PostAnalyticsResult = {
    likes: null,
    comments: null,
    shares: null,
    clicks: null,
    reach: null,
    impressions: null,
    views: null,
    saves: null,
    follows: null,
    engagementRate: null,
  };
  if (!metrics) return out;

  const add = (key: keyof PostAnalyticsResult, value: number) => {
    const current = out[key];
    out[key] = ((typeof current === "number" ? current : 0) + value) as never;
  };

  for (const m of metrics) {
    const value = typeof m.value === "number" ? m.value : 0;
    switch (m.type) {
      case "likes":
      case "reactions":
      case "favorites":
        add("likes", value);
        break;
      case "comments":
      case "replies":
        add("comments", value);
        break;
      case "shares":
      case "reposts":
      case "retweets":
      case "reblogs":
        add("shares", value);
        break;
      case "clicks":
      case "link_clicks":
        add("clicks", value);
        break;
      case "reach":
        out.reach = value;
        break;
      case "impressions":
        out.impressions = value;
        break;
      case "views":
      case "viewers":
        add("views", value);
        break;
      case "saves":
        out.saves = value;
        break;
      case "follows":
        out.follows = value;
        break;
      case "engagementRate":
        out.engagementRate = value;
        break;
      default:
        break;
    }
  }
  return out;
}

export class BufferProvider implements PublishingProvider {
  readonly name = "buffer";

  // Shared create path for schedule + publish-now + queue.
  //   - customScheduled targets a specific ISO time (`dueAtIso`).
  //   - shareNow publishes immediately.
  //   - addToQueue lets Buffer slot the post into the channel's next queue slot.
  private async createPost(
    input: SchedulePostInput | PublishPostInput,
    mode: "customScheduled" | "shareNow" | "addToQueue",
    dueAtIso?: string,
  ): Promise<PublishResult> {
    const channelId = await resolveChannelId(input.platform);
    logger.info(
      `[publish:buffer] createPost platform=${input.platform} channel=${channelId ? "set" : "missing"} mode=${mode}${dueAtIso ? ` at=${dueAtIso}` : ""}`,
    );

    if (!process.env.BUFFER_API_KEY) {
      return { success: false, error: "BUFFER_API_KEY not configured", provider: this.name };
    }
    if (!channelId) {
      return {
        success: false,
        error: `No Buffer channel configured or connected for platform ${input.platform}`,
        provider: this.name,
      };
    }

    // Attach the best available media: a video (with a poster thumbnail when we
    // have one) takes priority, otherwise the still image. Buffer expects the
    // @oneOf AssetInput shape — { image: {...} } or { video: {...} }.
    const videoUrl = input.videoUrl ?? (input.isVideo ? input.mediaUrl : undefined);
    const imageUrl =
      input.imageUrl ?? input.thumbnailUrl ?? (!input.isVideo ? input.mediaUrl : undefined);

    const assets: Array<Record<string, unknown>> = [];
    if (videoUrl) {
      const thumb = input.thumbnailUrl ?? imageUrl;
      assets.push({ video: { url: videoUrl, ...(thumb ? { thumbnailUrl: thumb } : {}) } });
    } else if (imageUrl) {
      assets.push({ image: { url: imageUrl } });
    }

    const postInput: Record<string, unknown> = {
      channelId,
      text: composeText(input.caption, input.hashtags, input.trackedUrl, input.platform),
      schedulingType: "automatic",
      mode,
      assets,
    };
    if (mode === "customScheduled" && dueAtIso) {
      postInput.dueAt = dueAtIso;
    }

    try {
      const data = (await bufferGraphQL(CREATE_POST_MUTATION, { input: postInput })) as CreatePostResult;
      const result = data?.createPost;
      if (!result) {
        return { success: false, error: "Buffer returned no createPost payload", provider: this.name };
      }
      if (result.message && !result.post) {
        logger.error(`[publish:buffer] createPost ${result.__typename ?? "error"}: ${result.message}`);
        return { success: false, error: result.message, provider: this.name };
      }
      const platformPostId = result.post?.id;
      if (!platformPostId) {
        return { success: false, error: "Buffer response missing post id", provider: this.name };
      }
      logger.info(
        `[publish:buffer] created post id=${platformPostId} status=${result.post?.status ?? "?"} dueAt=${result.post?.dueAt ?? "?"}`,
      );
      return { success: true, platformPostId, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[publish:buffer] createPost failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    return this.createPost(input, "customScheduled", input.scheduledAt.toISOString());
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    // shareNow publishes immediately (addToQueue would only enqueue for the next
    // slot — not what a "Publish Now" click expects).
    return this.createPost(input, "shareNow");
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
        publishedAt: post.sentAt ?? undefined,
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
      return { likes: null, comments: null, shares: null, clicks: null, reach: null, error: "BUFFER_API_KEY not configured" };
    }
    try {
      const data = (await bufferGraphQL(GET_POST_QUERY, { id: platformPostId })) as GetPostResult;
      const post = data?.post;
      if (!post) {
        return { likes: null, comments: null, shares: null, clicks: null, reach: null, error: "Buffer returned no post" };
      }
      return mapMetricsToAnalytics(post.metrics);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[publish:buffer] getAnalytics failed: ${message}`);
      return { likes: null, comments: null, shares: null, clicks: null, reach: null, error: message };
    }
  }
}

// ── Post retrieval + management (dashboard sync) ─────────────────────────────
// These power the admin "Buffer" surface: retrieving every post Buffer knows
// about (published / scheduled / draft / queued / sent / errored) and managing
// them (edit text, reschedule, delete, duplicate). They are exported standalone
// because they are Buffer-specific and not part of the platform-agnostic
// PublishingProvider contract.

export type BufferPostStatus = "draft" | "needs_approval" | "scheduled" | "sending" | "sent" | "error";

export interface BufferPostSummary {
  id: string;
  status: string;
  via: string;
  text: string;
  channelId: string;
  channelService: string;
  channelName: string;
  createdAt: string | null;
  dueAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  thumbnailUrl: string | null;
  hasVideo: boolean;
  metrics: PostAnalyticsResult | null;
  allowedActions: string[];
}

export interface ListBufferPostsParams {
  statuses?: BufferPostStatus[];
  channelIds?: string[];
  service?: string; // platform → resolve channel ids when channelIds not given
  first?: number;
  after?: string;
  includeMetrics?: boolean;
  sortDirection?: "asc" | "desc";
}

export interface ListBufferPostsResult {
  posts: BufferPostSummary[];
  endCursor: string | null;
  hasNextPage: boolean;
  error?: string;
}

function listPostsQuery(includeMetrics: boolean): string {
  return `
    query ListPosts($input: PostsInput!, $first: Int, $after: String) {
      posts(input: $input, first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            status
            via
            text
            createdAt
            dueAt
            sentAt
            channelId
            channelService
            channel { id name service }
            error { message }
            assets { type thumbnail }
            ${includeMetrics ? "metricsUpdatedAt metrics { type value }" : ""}
            allowedActions
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `;
}

interface RawBufferPost {
  id?: string;
  status?: string;
  via?: string;
  text?: string;
  createdAt?: string;
  dueAt?: string;
  sentAt?: string;
  channelId?: string;
  channelService?: string;
  channel?: { id?: string; name?: string; service?: string };
  error?: { message?: string } | null;
  assets?: Array<{ type?: string; thumbnail?: string }> | null;
  metrics?: BufferMetric[] | null;
  allowedActions?: string[];
}
interface ListPostsQueryResult {
  posts?: {
    edges?: Array<{ cursor?: string; node?: RawBufferPost }>;
    pageInfo?: { endCursor?: string; hasNextPage?: boolean };
  };
}

function normalizeBufferPost(node: RawBufferPost, includeMetrics: boolean): BufferPostSummary {
  const firstAsset = node.assets?.[0];
  return {
    id: node.id ?? "",
    status: node.status ?? "unknown",
    via: node.via ?? "",
    text: node.text ?? "",
    channelId: node.channelId ?? node.channel?.id ?? "",
    channelService: node.channelService ?? node.channel?.service ?? "",
    channelName: node.channel?.name ?? "",
    createdAt: node.createdAt ?? null,
    dueAt: node.dueAt ?? null,
    sentAt: node.sentAt ?? null,
    errorMessage: node.error?.message ?? null,
    thumbnailUrl: firstAsset?.thumbnail ?? null,
    hasVideo: Boolean(node.assets?.some((a) => a.type === "video")),
    metrics: includeMetrics ? mapMetricsToAnalytics(node.metrics) : null,
    allowedActions: node.allowedActions ?? [],
  };
}

// Retrieves posts directly from Buffer for the resolved organization.
export async function listBufferPosts(params: ListBufferPostsParams = {}): Promise<ListBufferPostsResult> {
  if (!process.env.BUFFER_API_KEY) {
    return { posts: [], endCursor: null, hasNextPage: false, error: "BUFFER_API_KEY not configured" };
  }
  const organizationId = await resolveOrganizationId();
  if (!organizationId) {
    return { posts: [], endCursor: null, hasNextPage: false, error: "No Buffer organization resolvable" };
  }

  // Resolve channel ids from a service hint when explicit ids were not supplied.
  let channelIds = params.channelIds;
  if ((!channelIds || channelIds.length === 0) && params.service) {
    const id = await resolveChannelId(params.service);
    if (id) channelIds = [id];
  }

  const filter: Record<string, unknown> = {};
  if (params.statuses && params.statuses.length > 0) filter.status = params.statuses;
  if (channelIds && channelIds.length > 0) filter.channelIds = channelIds;

  const input: Record<string, unknown> = {
    organizationId,
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
    sort: [{ field: "createdAt", direction: params.sortDirection ?? "desc" }],
  };

  const includeMetrics = Boolean(params.includeMetrics);
  try {
    const data = (await bufferGraphQL(listPostsQuery(includeMetrics), {
      input,
      first: Math.min(Math.max(params.first ?? 25, 1), 100),
      after: params.after ?? null,
    })) as ListPostsQueryResult;

    const edges = data?.posts?.edges ?? [];
    const posts = edges
      .map((e) => e.node)
      .filter((n): n is RawBufferPost => Boolean(n?.id))
      .map((n) => normalizeBufferPost(n, includeMetrics));
    return {
      posts,
      endCursor: data?.posts?.pageInfo?.endCursor ?? null,
      hasNextPage: Boolean(data?.posts?.pageInfo?.hasNextPage),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[publish:buffer] listBufferPosts failed: ${message}`);
    return { posts: [], endCursor: null, hasNextPage: false, error: message };
  }
}

// Fetches a single Buffer post with metrics (used for duplicate + detail).
export async function getBufferPost(id: string): Promise<BufferPostSummary | null> {
  if (!process.env.BUFFER_API_KEY) return null;
  try {
    const data = (await bufferGraphQL(
      `query GetPostDetail($id: PostId!) {
        post(input: { id: $id }) {
          id status via text createdAt dueAt sentAt channelId channelService
          channel { id name service }
          error { message }
          assets { type thumbnail source }
          metricsUpdatedAt metrics { type value }
          allowedActions
        }
      }`,
      { id },
    )) as { post?: RawBufferPost & { assets?: Array<{ type?: string; thumbnail?: string; source?: string }> } };
    if (!data?.post?.id) return null;
    return normalizeBufferPost(data.post, true);
  } catch (err) {
    logger.error(`[publish:buffer] getBufferPost failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export interface EditBufferPostParams {
  id: string;
  text?: string;
  dueAtIso?: string; // reschedule to this instant (customScheduled)
  mode?: "customScheduled" | "shareNow" | "addToQueue" | "shareNext";
}
export interface MutateBufferPostResult {
  success: boolean;
  id?: string;
  status?: string;
  error?: string;
}

// Edits a Buffer post — text and/or schedule. EditPostInput requires
// schedulingType + mode, so we send sensible defaults when only editing text.
export async function editBufferPost(params: EditBufferPostParams): Promise<MutateBufferPostResult> {
  if (!process.env.BUFFER_API_KEY) return { success: false, error: "BUFFER_API_KEY not configured" };
  const mode = params.mode ?? (params.dueAtIso ? "customScheduled" : "addToQueue");
  const input: Record<string, unknown> = {
    id: params.id,
    schedulingType: "automatic",
    mode,
  };
  if (typeof params.text === "string") input.text = params.text;
  if (mode === "customScheduled" && params.dueAtIso) input.dueAt = params.dueAtIso;

  try {
    const data = (await bufferGraphQL(EDIT_POST_MUTATION, { input })) as EditPostResult;
    const result = data?.editPost;
    if (!result) return { success: false, error: "Buffer returned no editPost payload" };
    if (result.message && !result.post) return { success: false, error: result.message };
    return { success: true, id: result.post?.id, status: result.post?.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[publish:buffer] editBufferPost failed: ${message}`);
    return { success: false, error: message };
  }
}

// Duplicates a Buffer post: copies its text + media onto the same channel as a
// new post. Defaults to adding the copy to the channel queue; pass dueAtIso to
// schedule it at a specific time.
export async function duplicateBufferPost(
  id: string,
  opts: { dueAtIso?: string } = {},
): Promise<MutateBufferPostResult> {
  if (!process.env.BUFFER_API_KEY) return { success: false, error: "BUFFER_API_KEY not configured" };
  try {
    const data = (await bufferGraphQL(
      `query DuplicateSource($id: PostId!) {
        post(input: { id: $id }) {
          text
          channelId
          assets { type source thumbnail }
        }
      }`,
      { id },
    )) as { post?: { text?: string; channelId?: string; assets?: Array<{ type?: string; source?: string; thumbnail?: string }> } };

    const src = data?.post;
    if (!src?.channelId) return { success: false, error: "Source post not found or missing channel" };

    const assets: Array<Record<string, unknown>> = [];
    for (const a of src.assets ?? []) {
      if (!a.source) continue;
      if (a.type === "video") assets.push({ video: { url: a.source, ...(a.thumbnail ? { thumbnailUrl: a.thumbnail } : {}) } });
      else if (a.type === "image") assets.push({ image: { url: a.source } });
    }

    const mode = opts.dueAtIso ? "customScheduled" : "addToQueue";
    const postInput: Record<string, unknown> = {
      channelId: src.channelId,
      text: src.text ?? "",
      schedulingType: "automatic",
      mode,
      assets,
    };
    if (opts.dueAtIso) postInput.dueAt = opts.dueAtIso;

    const created = (await bufferGraphQL(CREATE_POST_MUTATION, { input: postInput })) as CreatePostResult;
    const result = created?.createPost;
    if (result?.message && !result.post) return { success: false, error: result.message };
    if (!result?.post?.id) return { success: false, error: "Buffer response missing post id" };
    return { success: true, id: result.post.id, status: result.post.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[publish:buffer] duplicateBufferPost failed: ${message}`);
    return { success: false, error: message };
  }
}

// Deletes a Buffer post.
export async function deleteBufferPost(id: string): Promise<MutateBufferPostResult> {
  if (!process.env.BUFFER_API_KEY) return { success: false, error: "BUFFER_API_KEY not configured" };
  try {
    const data = (await bufferGraphQL(DELETE_POST_MUTATION, { input: { id } })) as DeletePostResult;
    const result = data?.deletePost;
    if (!result) return { success: false, error: "Buffer returned no deletePost payload" };
    if (result.message && !result.id) return { success: false, error: result.message };
    return { success: true, id: result.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[publish:buffer] deleteBufferPost failed: ${message}`);
    return { success: false, error: message };
  }
}

// ── Live connection verification ─────────────────────────────────────────────
// Used by the admin "Test Buffer Connection" action. Unlike the env-presence
// check in /api/admin/social/connections, this makes a real authenticated call:
// it validates the API key (account → organizations), lists the connected
// channels, and cross-references each configured BUFFER_PROFILE_* id against the
// real channels so a stale/wrong id surfaces as "not matched".

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  isDisconnected?: boolean;
  isLocked?: boolean;
}

export interface BufferConfiguredChannel {
  platform: string;
  profileId: string; // configured BUFFER_PROFILE_* value ("" when unset)
  present: boolean; // env var set
  matched: boolean; // configured id exists among real channels (or auto-resolved)
  channelName?: string; // name of the matched real channel
  autoResolved?: boolean; // matched via live service lookup (env not set)
}

export interface BufferVerifyResult {
  enabled: boolean; // ENABLE_BUFFER_PUBLISHING
  apiKeyPresent: boolean;
  apiKeyValid: boolean;
  organizations: { id: string; name: string }[];
  channels: BufferChannel[];
  configured: BufferConfiguredChannel[];
  error?: string;
}

interface AccountQueryResult {
  account?: { organizations?: { id?: string; name?: string }[] };
}
interface ChannelsQueryResult {
  channels?: { id?: string; name?: string; service?: string; isDisconnected?: boolean; isLocked?: boolean }[];
}

export async function verifyBufferConnection(): Promise<BufferVerifyResult> {
  const enabled = process.env.ENABLE_BUFFER_PUBLISHING === "true";
  const apiKeyPresent = Boolean(process.env.BUFFER_API_KEY && process.env.BUFFER_API_KEY.trim());

  const idMap = channelIdMap();
  // Each configured platform is "matched" when its env id maps to a real channel
  // OR (when no env id is set) a live channel exists for that platform's service,
  // which the provider auto-resolves at publish time.
  const buildConfigured = (channels: BufferChannel[]): BufferConfiguredChannel[] =>
    Object.entries(idMap).map(([platform, profileId]) => {
      const service = PLATFORM_SERVICE[platform];
      const byId = profileId ? channels.find((c) => c.id === profileId) : undefined;
      const byService = !profileId && service ? channels.find((c) => c.service === service) : undefined;
      const match = byId ?? byService;
      return {
        platform,
        profileId,
        present: Boolean(profileId),
        matched: Boolean(match),
        channelName: match?.name,
        autoResolved: Boolean(byService),
      };
    });

  if (!apiKeyPresent) {
    return {
      enabled,
      apiKeyPresent: false,
      apiKeyValid: false,
      organizations: [],
      channels: [],
      configured: buildConfigured([]),
      error: "BUFFER_API_KEY not configured",
    };
  }

  try {
    const acct = (await bufferGraphQL(ACCOUNT_QUERY)) as AccountQueryResult;
    const organizations = (acct?.account?.organizations ?? [])
      .filter((o): o is { id: string; name?: string } => Boolean(o?.id))
      .map((o) => ({ id: o.id, name: o.name ?? "" }));

    // Aggregate channels across every organization the token can see so a
    // profile id under any org still matches.
    const channels: BufferChannel[] = [];
    for (const org of organizations) {
      try {
        const data = (await bufferGraphQL(channelsQuery(org.id))) as ChannelsQueryResult;
        for (const c of data?.channels ?? []) {
          if (c?.id) {
            channels.push({
              id: c.id,
              name: c.name ?? "",
              service: c.service ?? "",
              isDisconnected: Boolean(c.isDisconnected),
              isLocked: Boolean(c.isLocked),
            });
          }
        }
      } catch (err) {
        logger.error(
          `[publish:buffer] verify channels failed for org ${org.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return {
      enabled,
      apiKeyPresent: true,
      apiKeyValid: true,
      organizations,
      channels,
      configured: buildConfigured(channels),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[publish:buffer] verifyConnection failed: ${message}`);
    return {
      enabled,
      apiKeyPresent: true,
      apiKeyValid: false,
      organizations: [],
      channels: [],
      configured: buildConfigured([]),
      error: message,
    };
  }
}
