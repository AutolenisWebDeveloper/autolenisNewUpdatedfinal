// AutoLenis Social Engine — Higgsfield video provider.
//
// Submits and polls AI video-generation jobs against Higgsfield. All endpoints
// are env-driven so the API surface can change without a code deploy, and the
// request/response field mapping is centralized in the small helpers below so a
// single edit updates every call site.
//
// TODO: verify exact field names against Higgsfield API docs.

import { prisma } from "@/lib/prisma";
import type { SocialVideo } from "@prisma/client";
import type {
  VideoGenerationProvider,
  VideoJobInput,
  VideoJobResult,
  VideoJobStatus,
} from "@/lib/social/providers/video-generation.provider";

function baseUrl(): string {
  return (process.env.HIGGSFIELD_API_BASE_URL ?? "https://api.higgsfield.ai").replace(/\/$/, "");
}
function submitEndpoint(): string {
  return process.env.HIGGSFIELD_SUBMIT_ENDPOINT ?? "/v1/videos/generate";
}
function statusEndpoint(): string {
  return process.env.HIGGSFIELD_STATUS_ENDPOINT ?? "/v1/videos/status";
}
function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.HIGGSFIELD_API_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

// Maps a Higgsfield status string to our normalized status union.
// TODO: verify exact status vocabulary against Higgsfield API docs.
function mapStatus(raw: unknown): VideoJobStatus["status"] {
  const s = String(raw ?? "").toLowerCase();
  if (["completed", "succeeded", "success", "done", "ready"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(s)) return "failed";
  if (["processing", "running", "generating", "in_progress"].includes(s)) return "processing";
  return "pending";
}

export class HiggsfieldProvider implements VideoGenerationProvider {
  readonly name = "higgsfield";

  async submitJob(input: VideoJobInput): Promise<VideoJobResult> {
    const apiKey = process.env.HIGGSFIELD_API_KEY;
    if (!apiKey) {
      await this.markVideoFailed(input.postId, "HIGGSFIELD_API_KEY not configured");
      return { success: false, error: "HIGGSFIELD_API_KEY not configured" };
    }

    try {
      const res = await fetch(`${baseUrl()}${submitEndpoint()}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          prompt: input.visualPrompt,
          duration: input.durationSeconds,
          style: input.style || "cinematic",
          voiceover: input.voiceoverText || null,
          on_screen_text: input.onScreenText || null,
          metadata: { post_id: input.postId, platform: "autolenis" },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = `Higgsfield HTTP ${res.status}: ${detail.slice(0, 200)}`;
        await this.markVideoFailed(input.postId, error);
        return { success: false, error };
      }

      const data = (await res.json()) as { id?: string; job_id?: string; jobId?: string };
      const providerJobId = data.job_id ?? data.jobId ?? data.id;
      if (!providerJobId) {
        const error = "Higgsfield response missing job id";
        await this.markVideoFailed(input.postId, error);
        return { success: false, error };
      }

      await prisma.socialVideo.update({
        where: { postId: input.postId },
        data: {
          providerJobId,
          status: "VIDEO_GENERATING",
          lastPolledAt: new Date(),
          errorMessage: null,
        },
      });
      return { success: true, providerJobId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.markVideoFailed(input.postId, error);
      return { success: false, error };
    }
  }

  async getJobStatus(jobId: string): Promise<VideoJobStatus> {
    try {
      const res = await fetch(`${baseUrl()}${statusEndpoint()}/${jobId}`, {
        method: "GET",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { jobId, status: "failed", error: `Higgsfield HTTP ${res.status}: ${detail.slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        status?: string;
        video_url?: string;
        videoUrl?: string;
        thumbnail_url?: string;
        thumbnailUrl?: string;
        error?: string;
      };
      return {
        jobId,
        status: mapStatus(data.status),
        videoUrl: data.video_url ?? data.videoUrl,
        thumbnailUrl: data.thumbnail_url ?? data.thumbnailUrl,
        error: data.error,
      };
    } catch (err) {
      return { jobId, status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }

  async retryFailed(video: SocialVideo): Promise<VideoJobResult> {
    await prisma.socialVideo.update({
      where: { id: video.id },
      data: { status: "VIDEO_QUEUED", retryCount: { increment: 1 }, errorMessage: null },
    });
    return this.submitJob({
      postId: video.postId,
      visualPrompt: video.visualPrompt ?? "",
      durationSeconds: video.durationSeconds ?? 30,
      style: video.style ?? undefined,
    });
  }

  private async markVideoFailed(postId: string, error: string): Promise<void> {
    await prisma.socialVideo
      .update({
        where: { postId },
        data: { status: "VIDEO_FAILED", errorMessage: error, lastPolledAt: new Date() },
      })
      .catch(() => undefined);
  }
}
