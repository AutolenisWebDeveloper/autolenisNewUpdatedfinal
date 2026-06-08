// AutoLenis Social Engine — Buffer publishing provider.
//
// Schedules/publishes posts and reads back status + interactions via the Buffer
// v1 API. One Buffer profile id per platform (env-driven). Bodies are
// form-encoded per the Buffer v1 contract.
//
// TODO: verify Buffer API v1 field names and form encoding.

import type {
  PublishingProvider,
  SchedulePostInput,
  PublishPostInput,
  PublishResult,
  PostStatusResult,
  PostAnalyticsResult,
} from "@/lib/social/providers/publishing.provider";

const BUFFER_BASE = "https://api.bufferapp.com/1";

function profileMap(): Record<string, string | undefined> {
  return {
    facebook: process.env.BUFFER_PROFILE_FACEBOOK,
    instagram: process.env.BUFFER_PROFILE_INSTAGRAM,
    tiktok: process.env.BUFFER_PROFILE_TIKTOK,
    youtube: process.env.BUFFER_PROFILE_YOUTUBE,
    linkedin: process.env.BUFFER_PROFILE_LINKEDIN,
  };
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.BUFFER_API_KEY ?? ""}` };
}

function composeText(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}

// Builds the application/x-www-form-urlencoded body Buffer v1 expects.
function buildForm(fields: Record<string, string | undefined>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") form.set(key, value);
  }
  return form;
}

export class BufferProvider implements PublishingProvider {
  readonly name = "buffer";

  private async createUpdate(
    input: SchedulePostInput | PublishPostInput,
    opts: { now?: boolean; scheduledAt?: Date },
  ): Promise<PublishResult> {
    const profileId = profileMap()[input.platform.toLowerCase()];
    if (!process.env.BUFFER_API_KEY) {
      return { success: false, error: "BUFFER_API_KEY not configured", provider: this.name };
    }
    if (!profileId) {
      return { success: false, error: `No Buffer profile for platform ${input.platform}`, provider: this.name };
    }

    const fields: Record<string, string | undefined> = {
      "profile_ids[]": profileId,
      text: composeText(input.caption, input.hashtags),
    };
    if (opts.now) fields.now = "true";
    if (opts.scheduledAt) fields.scheduled_at = opts.scheduledAt.toISOString();
    if (input.mediaUrl && input.isVideo) fields["media[video_url]"] = input.mediaUrl;
    else if (input.mediaUrl) fields["media[photo]"] = input.mediaUrl;

    try {
      const res = await fetch(`${BUFFER_BASE}/updates/create.json`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
        body: buildForm(fields).toString(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { success: false, error: `Buffer HTTP ${res.status}: ${detail.slice(0, 200)}`, provider: this.name };
      }
      const data = (await res.json()) as {
        success?: boolean;
        updates?: Array<{ id?: string }>;
      };
      const platformPostId = data.updates?.[0]?.id;
      if (!platformPostId) {
        return { success: false, error: "Buffer response missing update id", provider: this.name };
      }
      return { success: true, platformPostId, provider: this.name };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), provider: this.name };
    }
  }

  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    return this.createUpdate(input, { scheduledAt: input.scheduledAt });
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    return this.createUpdate(input, { now: true });
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    try {
      const res = await fetch(`${BUFFER_BASE}/updates/${platformPostId}.json`, {
        method: "GET",
        headers: authHeader(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { platformPostId, status: "unknown", error: `Buffer HTTP ${res.status}: ${detail.slice(0, 200)}` };
      }
      const data = (await res.json()) as { status?: string; sent_at?: number };
      return {
        platformPostId,
        status: data.status ?? "unknown",
        publishedAt: data.sent_at ? new Date(data.sent_at * 1000).toISOString() : undefined,
      };
    } catch (err) {
      return { platformPostId, status: "unknown", error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getAnalytics(platformPostId: string): Promise<PostAnalyticsResult> {
    try {
      const res = await fetch(`${BUFFER_BASE}/updates/${platformPostId}/interactions.json`, {
        method: "GET",
        headers: authHeader(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: `Buffer HTTP ${res.status}: ${detail.slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        statistics?: {
          likes?: number;
          comments?: number;
          shares?: number;
          clicks?: number;
          reach?: number;
          impressions?: number;
        };
      };
      const s = data.statistics ?? {};
      return {
        likes: s.likes ?? 0,
        comments: s.comments ?? 0,
        shares: s.shares ?? 0,
        clicks: s.clicks ?? 0,
        reach: s.reach ?? 0,
        impressions: s.impressions,
      };
    } catch (err) {
      return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
