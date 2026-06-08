// AutoLenis Social Engine — Video generation provider contract.
//
// Defines the provider-agnostic interface for AI video generation plus a
// no-op implementation used when video is disabled or unconfigured. The
// concrete Higgsfield implementation lives in higgsfield.provider.ts; the
// factory selects between them at runtime.

import type { SocialVideo } from "@prisma/client";

export interface VideoJobInput {
  postId: string;
  visualPrompt: string;
  durationSeconds: number;
  style?: string;
  voiceoverText?: string;
  onScreenText?: string;
}

export interface VideoJobResult {
  success: boolean;
  providerJobId?: string;
  error?: string;
}

export interface VideoJobStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface VideoGenerationProvider {
  readonly name: string;
  submitJob(input: VideoJobInput): Promise<VideoJobResult>;
  getJobStatus(jobId: string): Promise<VideoJobStatus>;
  retryFailed(video: SocialVideo): Promise<VideoJobResult>;
}

// No-op provider — logs and returns a non-success result without calling any
// external API. Selected when video generation is disabled or the key is unset.
export class NoopVideoProvider implements VideoGenerationProvider {
  readonly name = "noop";

  async submitJob(input: VideoJobInput): Promise<VideoJobResult> {
    console.log(`[video:noop] generation disabled — skipping job for post ${input.postId}`);
    return { success: false, error: "video generation disabled" };
  }

  async getJobStatus(jobId: string): Promise<VideoJobStatus> {
    return { jobId, status: "failed", error: "video generation disabled" };
  }

  async retryFailed(video: SocialVideo): Promise<VideoJobResult> {
    console.log(`[video:noop] retry skipped for video ${video.id}`);
    return { success: false, error: "video generation disabled" };
  }
}
