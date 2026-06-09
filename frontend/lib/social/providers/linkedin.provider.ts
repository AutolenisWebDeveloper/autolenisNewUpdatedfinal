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
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_VERSION = "202308";

function composeText(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}

export class LinkedInProvider implements PublishingProvider {
  readonly name = "linkedin";

  // Resolve the authenticated member's URN id via OpenID userinfo. The current
  // token carries `w_member_social` (person posting only), not
  // `w_organization_social`, so we must author as the member — not the company
  // organization — or LinkedIn rejects /author with HTTP 403. Returns undefined
  // when the lookup fails so the caller can fall back to Buffer.
  private async getMemberSub(token: string): Promise<string | undefined> {
    try {
      const res = await fetch(LINKEDIN_USERINFO_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": LINKEDIN_VERSION,
        },
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        console.error(`[publish:linkedin] userinfo HTTP ${res.status}: ${text.slice(0, 200)}`);
        return undefined;
      }
      const json = text ? (JSON.parse(text) as { sub?: string }) : {};
      return json.sub || undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish:linkedin] userinfo failed: ${message}`);
      return undefined;
    }
  }

  private async share(input: SchedulePostInput | PublishPostInput): Promise<PublishResult> {
    const token = process.env.LINKEDIN_ACCESS_TOKEN ?? "";
    console.log(`[publish:linkedin] share platform=${input.platform}`);

    if (!token) {
      return { success: false, error: "LINKEDIN_ACCESS_TOKEN not configured", provider: this.name };
    }

    // Author as the member (person URN). If userinfo fails the token can't
    // resolve a usable author, so fail cleanly and let the queue fall back to
    // Buffer (BUFFER_PROFILE_LINKEDIN).
    const sub = await this.getMemberSub(token);
    if (!sub) {
      return {
        success: false,
        error: "LinkedIn token lacks org scope — use Buffer",
        provider: this.name,
      };
    }

    const body = {
      author: `urn:li:person:${sub}`,
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
        // A 403 referencing the author field means the token lacks the scope to
        // post as this author. Fail cleanly (no retry) so the queue moves on.
        if (res.status === 403 && /author/i.test(text)) {
          return {
            success: false,
            error: "LinkedIn author field rejected — token may lack org scope",
            provider: this.name,
          };
        }
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
