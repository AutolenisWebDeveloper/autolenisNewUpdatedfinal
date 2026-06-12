// AutoLenis Social Engine — Meta (Facebook + Instagram) direct publishing.
//
// Publishes to the AutoLenis Facebook Page feed and Instagram Business account
// via the Meta Graph API (v18.0). Used by the publishing factory for the
// `facebook` and `instagram` platforms when META_ACCESS_TOKEN is configured;
// otherwise those platforms fall back to Buffer.
//
// Facebook suppresses link previews in the post body, so when a tracked URL is
// available it is added as the first comment on the published post. Instagram
// publishing is a three-step container flow (create → poll until FINISHED →
// publish) per the Graph API content-publishing spec.
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

const GRAPH_BASE = "https://graph.facebook.com/v18.0";

function composeMessage(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}

export class MetaProvider implements PublishingProvider {
  readonly name = "meta";

  private token(): string {
    return process.env.META_ACCESS_TOKEN ?? "";
  }
  private pageId(): string {
    return process.env.META_PAGE_ID ?? "";
  }
  private igAccountId(): string {
    return process.env.META_INSTAGRAM_ACCOUNT_ID ?? "";
  }

  // Unified entry for schedule + publish-now. PublishPostInput has no
  // scheduledAt, so callers without one publish immediately.
  private async post(
    input: (SchedulePostInput | PublishPostInput) & { scheduledAt?: Date },
  ): Promise<PublishResult> {
    const token = this.token();
    if (!token) {
      return { success: false, error: "META_ACCESS_TOKEN not configured", provider: this.name };
    }

    if (input.platform.toLowerCase() === "instagram") {
      return this.publishInstagram(input, token);
    }
    return this.publishFacebook(input, token);
  }

  // ─── Facebook ─────────────────────────────────────────────────────────────
  private async publishFacebook(
    input: (SchedulePostInput | PublishPostInput) & { scheduledAt?: Date },
    token: string,
  ): Promise<PublishResult> {
    const pageId = this.pageId();
    console.log(`[publish:meta] facebook page=${pageId ? "set" : "missing"}`);
    if (!pageId) {
      return { success: false, error: "META_PAGE_ID not configured", provider: this.name };
    }

    const scheduledAt = input.scheduledAt ?? new Date();
    const inFuture = scheduledAt.getTime() > Date.now();

    const params = new URLSearchParams();
    params.set("access_token", token);
    params.set("message", composeMessage(input.caption, input.hashtags));
    params.set("published", inFuture ? "false" : "true");
    if (inFuture) {
      params.set("scheduled_publish_time", String(Math.floor(scheduledAt.getTime() / 1000)));
    }

    try {
      const res = await fetch(`${GRAPH_BASE}/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.id) {
        const detail = data.error?.message ?? `HTTP ${res.status}`;
        console.error(`[publish:meta] facebook feed failed: ${detail}`);
        return { success: false, error: detail, provider: this.name };
      }

      // Facebook suppresses links in captions — add the tracked URL as the
      // first comment so it remains clickable. Best-effort, non-fatal.
      const trackedUrl = input.trackedUrl;
      if (trackedUrl) {
        const commentParams = new URLSearchParams();
        commentParams.set("access_token", token);
        commentParams.set("message", `🔗 ${trackedUrl}`);
        await fetch(`${GRAPH_BASE}/${data.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: commentParams,
        }).catch((err) =>
          console.warn("[publish:meta] facebook link comment failed (non-fatal):", err),
        );
      }

      console.log(`[publish:meta] facebook published id=${data.id}`);
      return { success: true, platformPostId: data.id, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:meta] facebook failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  // ─── Instagram ───────────────────────────────────────────────────────────
  private async publishInstagram(
    input: SchedulePostInput | PublishPostInput,
    token: string,
  ): Promise<PublishResult> {
    const igAccountId = this.igAccountId();
    console.log(`[publish:meta] instagram account=${igAccountId ? "set" : "missing"}`);
    if (!igAccountId) {
      return { success: false, error: "META_INSTAGRAM_ACCOUNT_ID not configured", provider: this.name };
    }

    const videoUrl = input.videoUrl ?? (input.isVideo ? input.mediaUrl : undefined);
    const imageUrl = input.imageUrl ?? input.thumbnailUrl ?? (!input.isVideo ? input.mediaUrl : undefined);

    try {
      // Step 1 — create the media container.
      const createParams = new URLSearchParams();
      createParams.set("access_token", token);
      createParams.set("caption", composeMessage(input.caption, input.hashtags));
      createParams.set("media_type", videoUrl ? "REELS" : "IMAGE");
      if (videoUrl) {
        createParams.set("video_url", videoUrl);
      } else if (imageUrl) {
        createParams.set("image_url", imageUrl);
      } else {
        return { success: false, error: "Instagram requires an image or video URL", provider: this.name };
      }

      const createRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: createParams,
      });
      const createData = (await createRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!createRes.ok || createData.error || !createData.id) {
        const detail = createData.error?.message ?? `HTTP ${createRes.status}`;
        console.error(`[publish:meta] instagram container failed: ${detail}`);
        return { success: false, error: detail, provider: this.name };
      }
      const containerId = createData.id;

      // Step 2 — poll until the container reports FINISHED (max 30s, every 3s).
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const statusRes = await fetch(
          `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${token}`,
        );
        const statusData = (await statusRes.json().catch(() => ({}))) as {
          status_code?: string;
        };
        if (statusData.status_code === "FINISHED") {
          ready = true;
          break;
        }
        if (statusData.status_code === "ERROR" || statusData.status_code === "EXPIRED") {
          return {
            success: false,
            error: `Instagram container ${statusData.status_code}`,
            provider: this.name,
          };
        }
      }
      if (!ready) {
        return { success: false, error: "Instagram container not ready within 30s", provider: this.name };
      }

      // Step 3 — publish the container.
      const publishParams = new URLSearchParams();
      publishParams.set("access_token", token);
      publishParams.set("creation_id", containerId);
      const publishRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: publishParams,
      });
      const publishData = (await publishRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!publishRes.ok || publishData.error || !publishData.id) {
        const detail = publishData.error?.message ?? `HTTP ${publishRes.status}`;
        console.error(`[publish:meta] instagram publish failed: ${detail}`);
        return { success: false, error: detail, provider: this.name };
      }

      console.log(`[publish:meta] instagram published id=${publishData.id}`);
      return { success: true, platformPostId: publishData.id, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:meta] instagram failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    return this.post(input);
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    return this.post({ ...input, scheduledAt: new Date() });
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    const token = this.token();
    if (!token) {
      return { platformPostId, status: "unknown", error: "META_ACCESS_TOKEN not configured" };
    }
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${platformPostId}?fields=id,message,created_time&access_token=${token}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        created_time?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error) {
        return { platformPostId, status: "unknown", error: data.error?.message ?? `HTTP ${res.status}` };
      }
      return { platformPostId, status: "published", publishedAt: data.created_time };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platformPostId, status: "unknown", error: message };
    }
  }

  // Platform hint for analytics routing. The PublishingProvider interface only
  // passes platformPostId to getAnalytics(), so the sync endpoint sets this
  // before calling so we know whether to hit the Facebook or Instagram surface.
  private analyticsPlatform?: string;

  // Allow the sync endpoint to scope this provider instance to one platform
  // (facebook | instagram) so getAnalytics routes to the right Graph surface.
  setAnalyticsPlatform(platform?: string): this {
    this.analyticsPlatform = platform?.toLowerCase();
    return this;
  }

  // Detect whether a platformPostId looks like a Facebook post (contains an
  // underscore, e.g. 123456_789012) or an Instagram media id (all digits).
  private looksLikeFacebookPost(id: string): boolean {
    return id.includes("_");
  }

  async getAnalytics(platformPostId: string, platform?: string): Promise<PostAnalyticsResult> {
    const token = this.token();
    const zeros: PostAnalyticsResult = { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0 };
    if (!token) {
      return { ...zeros, error: "META_ACCESS_TOKEN not configured" };
    }

    // Resolve the platform from (a) the explicit arg, (b) the instance hint set
    // by the sync endpoint, or (c) the shape of the id as a last resort.
    const hint = (platform ?? this.analyticsPlatform)?.toLowerCase();
    const isInstagram =
      hint === "instagram" ||
      (hint !== "facebook" && !this.looksLikeFacebookPost(platformPostId));

    try {
      const perPost = isInstagram
        ? await this.getInstagramAnalytics(platformPostId, token)
        : await this.getFacebookAnalytics(platformPostId, token);

      // Best-effort account-level audience demographics (Instagram only).
      const audience = isInstagram ? await this.getAudienceInsights(token) : {};

      return { ...perPost, ...audience };
    } catch (err) {
      console.error("[publish:meta] getAnalytics failed (non-fatal):", err);
      return zeros;
    }
  }

  // ─── Facebook page post insights ───────────────────────────────────────────
  private async getFacebookAnalytics(postId: string, token: string): Promise<PostAnalyticsResult> {
    const zeros: PostAnalyticsResult = { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0 };
    const metrics = [
      "post_impressions",
      "post_impressions_unique",
      "post_engaged_users",
      "post_clicks",
      "post_reactions_like_total",
      "post_video_views",
      "post_video_complete_views_30s",
    ].join(",");

    const res = await fetch(
      `${GRAPH_BASE}/${postId}/insights?metric=${metrics}&access_token=${token}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      data?: { name?: string; values?: { value?: number }[] }[];
      error?: { message?: string };
    };
    if (!res.ok || data.error || !data.data) {
      if (data.error) console.error(`[publish:meta] facebook insights: ${data.error.message}`);
      return zeros;
    }
    const metric = (name: string): number =>
      data.data?.find((m) => m.name === name)?.values?.[0]?.value ?? 0;

    // Comments + shares are not insight metrics — read them off the post object.
    const { comments, shares } = await this.getFacebookEngagement(postId, token);

    const impressions = metric("post_impressions");
    const reach = metric("post_impressions_unique");
    const likes = metric("post_reactions_like_total");
    const views = metric("post_video_views");
    const complete = metric("post_video_complete_views_30s");

    return {
      likes,
      comments,
      shares,
      clicks: metric("post_clicks"),
      reach,
      impressions,
      views,
      completionRate: views > 0 ? complete / views : undefined,
      engagementRate: reach > 0 ? (likes + comments + shares) / reach : undefined,
    };
  }

  // Comment + share counts via the post object summary (not /insights).
  private async getFacebookEngagement(
    postId: string,
    token: string,
  ): Promise<{ comments: number; shares: number }> {
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${postId}?fields=comments.summary(true),shares&access_token=${token}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        comments?: { summary?: { total_count?: number } };
        shares?: { count?: number };
      };
      return {
        comments: data.comments?.summary?.total_count ?? 0,
        shares: data.shares?.count ?? 0,
      };
    } catch {
      return { comments: 0, shares: 0 };
    }
  }

  // ─── Instagram media insights ──────────────────────────────────────────────
  private async getInstagramAnalytics(mediaId: string, token: string): Promise<PostAnalyticsResult> {
    const zeros: PostAnalyticsResult = { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0 };
    const metrics = [
      "impressions",
      "reach",
      "likes",
      "comments",
      "shares",
      "saved",
      "video_views",
      "plays",
      "total_interactions",
    ].join(",");

    const res = await fetch(
      `${GRAPH_BASE}/${mediaId}/insights?metric=${metrics}&access_token=${token}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      data?: { name?: string; values?: { value?: number }[] }[];
      error?: { message?: string };
    };
    if (!res.ok || data.error || !data.data) {
      if (data.error) console.error(`[publish:meta] instagram insights: ${data.error.message}`);
      return zeros;
    }
    const metric = (name: string): number =>
      data.data?.find((m) => m.name === name)?.values?.[0]?.value ?? 0;

    const reach = metric("reach");
    const totalInteractions = metric("total_interactions");

    return {
      likes: metric("likes"),
      comments: metric("comments"),
      shares: metric("shares"),
      clicks: 0,
      reach,
      impressions: metric("impressions"),
      saves: metric("saved"),
      views: metric("video_views") || metric("plays"),
      engagementRate: reach > 0 ? totalInteractions / reach : undefined,
    };
  }

  // ─── Account-level audience demographics (Instagram) ───────────────────────
  // Lifetime audience breakdowns are exposed on the IG Business account, not on
  // individual media. Only fetched when META_INSTAGRAM_ACCOUNT_ID is set.
  private async getAudienceInsights(token: string): Promise<Partial<PostAnalyticsResult>> {
    const igAccountId = this.igAccountId();
    if (!igAccountId) return {};
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${igAccountId}/insights` +
          `?metric=audience_country,audience_gender_age&period=lifetime&access_token=${token}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        data?: { name?: string; values?: { value?: Record<string, number> }[] }[];
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.data) return {};

      const valuesFor = (name: string): Record<string, number> =>
        data.data?.find((m) => m.name === name)?.values?.[0]?.value ?? {};

      const out: Partial<PostAnalyticsResult> = {};

      // audience_country: { "US": 1234, "CA": 567, ... }
      const countries = valuesFor("audience_country");
      const countryTotal = Object.values(countries).reduce((a, b) => a + b, 0);
      if (countryTotal > 0) {
        out.audienceCountries = Object.entries(countries)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([country, n]) => ({ country, pct: Math.round((n / countryTotal) * 100) }));
      }

      // audience_gender_age: { "M.25-34": 100, "F.25-34": 120, ... }
      const genderAge = valuesFor("audience_gender_age");
      const gaTotal = Object.values(genderAge).reduce((a, b) => a + b, 0);
      if (gaTotal > 0) {
        const ageBuckets = new Map<string, number>();
        const genderBuckets = new Map<string, number>();
        for (const [key, n] of Object.entries(genderAge)) {
          const [gender, range] = key.split(".");
          if (range) ageBuckets.set(range, (ageBuckets.get(range) ?? 0) + n);
          if (gender) {
            const label = gender === "M" ? "male" : gender === "F" ? "female" : "unknown";
            genderBuckets.set(label, (genderBuckets.get(label) ?? 0) + n);
          }
        }
        out.audienceAgeRanges = [...ageBuckets.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([range, n]) => ({ range, pct: Math.round((n / gaTotal) * 100) }));
        out.audienceGenders = [...genderBuckets.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([gender, n]) => ({ gender, pct: Math.round((n / gaTotal) * 100) }));
      }

      return out;
    } catch (err) {
      console.error("[publish:meta] audience insights failed (non-fatal):", err);
      return {};
    }
  }
}
