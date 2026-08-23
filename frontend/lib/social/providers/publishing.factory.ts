// AutoLenis Social Engine — Publishing provider factory.
//
// Returns the right publishing provider for a platform. Each retained platform
// publishes through its own DIRECT API when the corresponding access token is
// configured; when it isn't, the caller gets a no-op provider that fails
// EXPLICITLY (success:false) — it never silently succeeds and never falls back to
// a third party:
//   - facebook / instagram → Meta Graph API (META_ACCESS_TOKEN) else explicit fail
//   - tiktok               → TikTok Content API (TIKTOK_ACCESS_TOKEN) else explicit fail
//   - linkedin             → LinkedIn v2 API (LINKEDIN_ACCESS_TOKEN) else explicit fail
//   - youtube              → YouTubeProvider: analytics only (Data API). Publishing
//                            was Buffer-only and has been RETIRED — publish fails
//                            explicitly (no direct YouTube publish surface).
//   - unknown              → explicit fail
//
// Buffer has been retired: there is no third-party publishing fallback. A channel
// without a configured direct token surfaces a truthful failure rather than a
// silent hand-off.

import {
  NoopPublishingProvider,
  type PublishingProvider,
} from "@/lib/social/providers/publishing.provider";
import { LinkedInProvider } from "@/lib/social/providers/linkedin.provider";
import { MetaProvider } from "@/lib/social/providers/meta.provider";
import { TikTokProvider } from "@/lib/social/providers/tiktok.provider";
import { YouTubeProvider } from "@/lib/social/providers/youtube.provider";

export function getPublishingProvider(platform?: string): PublishingProvider {
  switch (platform?.toLowerCase()) {
    case "facebook":
    case "instagram":
      // Meta Graph API when configured; otherwise an explicit, non-fabricated failure.
      return process.env.META_ACCESS_TOKEN ? new MetaProvider() : new NoopPublishingProvider();
    case "tiktok":
      return process.env.TIKTOK_ACCESS_TOKEN ? new TikTokProvider() : new NoopPublishingProvider();
    case "linkedin":
      // LinkedIn direct when a token is configured. The provider fails cleanly
      // (no retry) when its token can't author the post — there is no longer a
      // Buffer fallback, so that failure is final and surfaced to the admin.
      return process.env.LINKEDIN_ACCESS_TOKEN ? new LinkedInProvider() : new NoopPublishingProvider();
    case "youtube":
      // Analytics read from the YouTube Data API; publishing (formerly delegated
      // to Buffer) is retired and fails explicitly inside YouTubeProvider.
      return new YouTubeProvider();
    default:
      // Unknown platforms have no publish surface — fail explicitly.
      return new NoopPublishingProvider();
  }
}
