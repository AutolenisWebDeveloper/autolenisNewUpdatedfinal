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
    const zeros: PostAnalyticsResult = { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0 };
    const token = process.env.LINKEDIN_ACCESS_TOKEN ?? "";
    if (!token) {
      return { ...zeros, error: "LINKEDIN_ACCESS_TOKEN not configured" };
    }

    // Strip any urn: prefix the caller may have stored, then re-derive the bare
    // share id so we can rebuild the urn consistently below.
    const shareId = platformPostId.replace(/^urn:li:(share|ugcPost):/, "");

    // Try the organization share-statistics surface first (richer, but requires
    // r_organization_social). Fall back to the member socialActions endpoint.
    const orgStats = await this.getOrgShareStatistics(token, shareId);
    const base = orgStats ?? (await this.getMemberShareStatistics(token, shareId)) ?? zeros;

    // Best-effort account-level follower demographics (org scope only).
    const audience = await this.getFollowerDemographics(token);

    return { ...base, ...audience };
  }

  // Organization share statistics — requires r_organization_social +
  // LINKEDIN_COMPANY_PAGE_ID. Returns null on 403/error so the caller falls back.
  private async getOrgShareStatistics(
    token: string,
    shareId: string,
  ): Promise<PostAnalyticsResult | null> {
    const orgId = process.env.LINKEDIN_COMPANY_PAGE_ID ?? "";
    if (!orgId) return null;
    try {
      const org = encodeURIComponent(`urn:li:organization:${orgId}`);
      const share = encodeURIComponent(`urn:li:share:${shareId}`);
      const url =
        `https://api.linkedin.com/v2/organizationalEntityShareStatistics` +
        `?q=organizationalEntity&organizationalEntity=${org}&shares[0]=${share}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });
      if (res.status === 403) {
        console.error("[publish:linkedin] LinkedIn org scope needed — falling back to member endpoint");
        return null;
      }
      const data = (await res.json().catch(() => ({}))) as {
        elements?: Array<{
          totalShareStatistics?: {
            likeCount?: number;
            commentCount?: number;
            shareCount?: number;
            clickCount?: number;
            impressionCount?: number;
            engagement?: number;
          };
        }>;
      };
      const stats = data.elements?.[0]?.totalShareStatistics;
      if (!res.ok || !stats) return null;
      return {
        likes: stats.likeCount ?? 0,
        comments: stats.commentCount ?? 0,
        shares: stats.shareCount ?? 0,
        clicks: stats.clickCount ?? 0,
        reach: stats.impressionCount ?? 0,
        impressions: stats.impressionCount ?? 0,
        engagementRate: stats.engagement,
      };
    } catch (err) {
      console.error("[publish:linkedin] org share statistics failed (non-fatal):", err);
      return null;
    }
  }

  // Member share statistics (fallback) — works under w_member_social but only
  // exposes like + comment counts. Returns null on 403/error → zeros.
  private async getMemberShareStatistics(
    token: string,
    shareId: string,
  ): Promise<PostAnalyticsResult | null> {
    try {
      const urn = encodeURIComponent(`urn:li:share:${shareId}`);
      const res = await fetch(`https://api.linkedin.com/v2/socialActions/${urn}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });
      if (res.status === 403) {
        console.error("[publish:linkedin] LinkedIn analytics unavailable — token lacks scope");
        return null;
      }
      const data = (await res.json().catch(() => ({}))) as {
        likesSummary?: { totalLikes?: number };
        commentsSummary?: { totalFirstLevelComments?: number };
      };
      if (!res.ok) return null;
      return {
        likes: data.likesSummary?.totalLikes ?? 0,
        comments: data.commentsSummary?.totalFirstLevelComments ?? 0,
        shares: 0, // not available in this endpoint
        clicks: 0, // not available in this endpoint
        reach: 0,
      };
    } catch (err) {
      console.error("[publish:linkedin] member share statistics failed (non-fatal):", err);
      return null;
    }
  }

  // Account-level follower demographics (org scope). Only fetched when
  // LINKEDIN_COMPANY_PAGE_ID is set; failures are non-fatal.
  private async getFollowerDemographics(token: string): Promise<Partial<PostAnalyticsResult>> {
    const orgId = process.env.LINKEDIN_COMPANY_PAGE_ID ?? "";
    if (!orgId) return {};
    try {
      const org = encodeURIComponent(`urn:li:organization:${orgId}`);
      const url =
        `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics` +
        `?q=organizationalEntity&organizationalEntity=${org}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });
      if (!res.ok) return {};
      const data = (await res.json().catch(() => ({}))) as {
        elements?: Array<{
          followerCountsByGeoCountry?: Array<{
            geoCountry?: string;
            followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number };
          }>;
          followerCountsByStaffCountRange?: Array<{
            staffCountRange?: string;
            followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number };
          }>;
        }>;
      };
      const el = data.elements?.[0];
      if (!el) return {};

      const sum = (c?: { organicFollowerCount?: number; paidFollowerCount?: number }): number =>
        (c?.organicFollowerCount ?? 0) + (c?.paidFollowerCount ?? 0);

      const out: Partial<PostAnalyticsResult> = {};

      const geo = el.followerCountsByGeoCountry ?? [];
      const geoTotal = geo.reduce((a, g) => a + sum(g.followerCounts), 0);
      if (geoTotal > 0) {
        out.audienceCountries = geo
          .map((g) => ({ country: g.geoCountry ?? "unknown", n: sum(g.followerCounts) }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 10)
          .map((g) => ({ country: g.country, pct: Math.round((g.n / geoTotal) * 100) }));
      }

      // staffCountRange is a proxy for company-size context, surfaced in the
      // ageRanges slot since LinkedIn does not expose member age demographics.
      const staff = el.followerCountsByStaffCountRange ?? [];
      const staffTotal = staff.reduce((a, s) => a + sum(s.followerCounts), 0);
      if (staffTotal > 0) {
        out.audienceAgeRanges = staff
          .map((s) => ({ range: s.staffCountRange ?? "unknown", n: sum(s.followerCounts) }))
          .sort((a, b) => b.n - a.n)
          .map((s) => ({ range: s.range, pct: Math.round((s.n / staffTotal) * 100) }));
      }

      return out;
    } catch (err) {
      console.error("[publish:linkedin] follower demographics failed (non-fatal):", err);
      return {};
    }
  }
}
