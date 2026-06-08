// AutoLenis Social Engine — Video provider factory.
//
// Returns the live Higgsfield provider when video is enabled and configured,
// otherwise a no-op provider so callers never need to branch on config.

import { ENABLE_VIDEO } from "@/lib/social/config";
import {
  NoopVideoProvider,
  type VideoGenerationProvider,
} from "@/lib/social/providers/video-generation.provider";
import { HiggsfieldProvider } from "@/lib/social/providers/higgsfield.provider";

export function getVideoProvider(): VideoGenerationProvider {
  if (ENABLE_VIDEO && process.env.HIGGSFIELD_API_KEY) {
    return new HiggsfieldProvider();
  }
  return new NoopVideoProvider();
}
