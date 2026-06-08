// AutoLenis Social Engine — Publishing provider factory.
//
// Returns the live Buffer provider when publishing is enabled and configured,
// otherwise a no-op provider so callers never branch on config.

import { ENABLE_PUBLISHING } from "@/lib/social/config";
import {
  NoopPublishingProvider,
  type PublishingProvider,
} from "@/lib/social/providers/publishing.provider";
import { BufferProvider } from "@/lib/social/providers/buffer.provider";

export function getPublishingProvider(): PublishingProvider {
  if (ENABLE_PUBLISHING && process.env.BUFFER_API_KEY) {
    return new BufferProvider();
  }
  return new NoopPublishingProvider();
}
