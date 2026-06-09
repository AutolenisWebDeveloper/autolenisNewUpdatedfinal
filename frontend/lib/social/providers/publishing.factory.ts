// AutoLenis Social Engine — Publishing provider factory.
//
// Returns the right publishing provider for a platform. Each platform prefers
// its own direct API when the corresponding access token is configured, and
// falls back to Buffer otherwise:
//   - facebook / instagram → Meta Graph API (META_ACCESS_TOKEN) else Buffer
//   - tiktok               → TikTok Content API (TIKTOK_ACCESS_TOKEN) else Buffer
//   - linkedin             → LinkedIn v2 API (LINKEDIN_ACCESS_TOKEN) else Buffer
//   - youtube / unknown    → Buffer
//
// Buffer self-gates on ENABLE_BUFFER_PUBLISHING + BUFFER_API_KEY and skips
// gracefully when unconfigured, so callers never branch on config.

import { ENABLE_PUBLISHING } from "@/lib/social/config";
import {
  NoopPublishingProvider,
  type PublishingProvider,
} from "@/lib/social/providers/publishing.provider";
import { BufferProvider } from "@/lib/social/providers/buffer.provider";
import { LinkedInProvider } from "@/lib/social/providers/linkedin.provider";
import { MetaProvider } from "@/lib/social/providers/meta.provider";
import { TikTokProvider } from "@/lib/social/providers/tiktok.provider";

// Buffer when enabled + configured, otherwise a no-op so callers never branch.
function bufferOrNoop(): PublishingProvider {
  if (ENABLE_PUBLISHING && process.env.BUFFER_API_KEY) {
    return new BufferProvider();
  }
  return new NoopPublishingProvider();
}

export function getPublishingProvider(platform?: string): PublishingProvider {
  switch (platform?.toLowerCase()) {
    case "facebook":
    case "instagram":
      return process.env.META_ACCESS_TOKEN ? new MetaProvider() : bufferOrNoop();
    case "tiktok":
      return process.env.TIKTOK_ACCESS_TOKEN ? new TikTokProvider() : bufferOrNoop();
    case "linkedin":
      return process.env.LINKEDIN_ACCESS_TOKEN ? new LinkedInProvider() : bufferOrNoop();
    default:
      // youtube + unknown publish via Buffer.
      return bufferOrNoop();
  }
}
