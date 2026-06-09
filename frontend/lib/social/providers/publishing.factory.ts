// AutoLenis Social Engine — Publishing provider factory.
//
// Returns the right publishing provider for a platform: LinkedIn posts go
// directly to the LinkedIn v2 API when LINKEDIN_ACCESS_TOKEN is set; everything
// else (and LinkedIn without a token) uses Buffer when publishing is enabled and
// configured, otherwise a no-op provider so callers never branch on config.

import { ENABLE_PUBLISHING } from "@/lib/social/config";
import {
  NoopPublishingProvider,
  type PublishingProvider,
} from "@/lib/social/providers/publishing.provider";
import { BufferProvider } from "@/lib/social/providers/buffer.provider";
import { LinkedInProvider } from "@/lib/social/providers/linkedin.provider";

export function getPublishingProvider(platform?: string): PublishingProvider {
  // LinkedIn company-page posts publish directly via the LinkedIn API when a
  // token is configured — independent of the Buffer publishing flag.
  if (platform?.toLowerCase() === "linkedin" && process.env.LINKEDIN_ACCESS_TOKEN) {
    return new LinkedInProvider();
  }
  if (ENABLE_PUBLISHING && process.env.BUFFER_API_KEY) {
    return new BufferProvider();
  }
  return new NoopPublishingProvider();
}
