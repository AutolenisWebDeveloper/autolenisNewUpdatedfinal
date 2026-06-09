// AutoLenis Social Engine — LinkedIn direct publishing provider.
//
// Publishes text posts to the AutoLenis LinkedIn company page via the LinkedIn
// v2 ugcPosts API. Used by the publishing factory for the `linkedin` platform
// when LINKEDIN_ACCESS_TOKEN is configured; all other platforms fall back to
// Buffer.
//
// Token expires ~Aug 8 2026. Rotate via
// linkedin.com/developers/tools/oauth/token-generator
//
// LinkedIn's ugcPosts endpoint publishes immediately and does not expose native
// scheduling or per-post analytics under the basic share scopes, so
// schedulePost() publishes now and getPostStatus()/getAnalytics() return
// best-effort results. All methods log and never throw unhandled errors.

import type {
  PublishingProvider,
  SchedulePostInput,
  PublishPostInput,
  PublishResult,
  PostStatusResult,
  PostAnalyticsResult,
} from "@/lib/social/providers/publishing.provider";

const LINKEDIN_UGC_URL = "https://api.linkedin.com/v2/ugcPosts";

function composeText(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}

export class LinkedInProvider implements PublishingProvider {
  readonly name = "linkedin";

  private async share(input: SchedulePostInput | PublishPostInput): Promise<PublishResult> {
    const token = process.env.LINKEDIN_ACCESS_TOKEN ?? "";
    const pageId = process.env.LINKEDIN_COMPANY_PAGE_ID ?? "";
    console.log(
      `[publish:linkedin] share platform=${input.platform} page=${pageId ? "set" : "missing"}`,
    );

    if (!token) {
      return { success: false, error: "LINKEDIN_ACCESS_TOKEN not configured", provider: this.name };
    }
    if (!pageId) {
      return { success: false, error: "LINKEDIN_COMPANY_PAGE_ID not configured", provider: this.name };
    }

    const body = {
      author: `urn:li:organization:${pageId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text: composeText(input.caption, input.hashtags),
          },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    try {
      const res = await fetch(LINKEDIN_UGC_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(body),
      });

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const detail = text.slice(0, 300);
        console.error(`[publish:linkedin] HTTP ${res.status}: ${detail}`);
        return { success: false, error: `LinkedIn HTTP ${res.status}: ${detail}`, provider: this.name };
      }

      let json: { id?: string } = {};
      try {
        json = text ? (JSON.parse(text) as { id?: string }) : {};
      } catch {
        json = {};
      }
      // LinkedIn returns the urn as `id`, or via the `x-restli-id` response header.
      const platformPostId = json.id ?? res.headers.get("x-restli-id") ?? undefined;
      if (!platformPostId) {
        return { success: false, error: "LinkedIn response missing post id", provider: this.name };
      }
      console.log(`[publish:linkedin] published id=${platformPostId}`);
      return { success: true, platformPostId, provider: this.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:linkedin] share failed: ${message}`);
      return { success: false, error: message, provider: this.name };
    }
  }

  // LinkedIn ugcPosts has no native scheduling under basic share scopes —
  // publish immediately. The publish-queue cron only hands us posts whose
  // scheduled time has effectively arrived.
  async schedulePost(input: SchedulePostInput): Promise<PublishResult> {
    return this.share(input);
  }

  async publishNow(input: PublishPostInput): Promise<PublishResult> {
    return this.share(input);
  }

  async getPostStatus(platformPostId: string): Promise<PostStatusResult> {
    // Once published via ugcPosts the share is live; richer status requires
    // additional scopes we don't request.
    console.log(`[publish:linkedin] getPostStatus id=${platformPostId}`);
    return { platformPostId, status: "PUBLISHED" };
  }

  async getAnalytics(platformPostId: string): Promise<PostAnalyticsResult> {
    // Organization share statistics require the rw_organization_admin scope and
    // a separate API surface; return zeros best-effort so the sync cron never
    // fails on LinkedIn posts.
    console.log(`[publish:linkedin] getAnalytics id=${platformPostId} (not available under basic scopes)`);
    return { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0 };
  }
}
