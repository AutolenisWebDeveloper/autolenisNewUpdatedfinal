// AutoLenis Social Engine — Higgsfield video provider (production).
//
// Submits and polls AI media-generation jobs against the Higgsfield platform
// API using the confirmed production field names. Every job is mirrored into the
// AiMediaGeneration table (keyed by the provider request_id) so webhooks and the
// polling cron can reconcile against a single source of truth.
//
// Auth: HF_CREDENTIALS ("key_id:key_secret") → HTTP Basic, with a
// HIGGSFIELD_API_KEY Bearer fallback. Base URL is env-driven and defaults to
// the production platform host.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { SocialVideo } from "@prisma/client";
import type {
  VideoGenerationProvider,
  VideoJobInput,
  VideoJobResult,
  VideoJobStatus,
} from "@/lib/social/providers/video-generation.provider";
import type {
  AutoLenisAiMediaRequest,
  HiggsfieldResponse,
} from "@/lib/social/providers/higgsfield.types";

const WEBHOOK_URL = "https://www.autolenis.com/api/webhooks/higgsfield";

// True when Higgsfield credentials are configured. Higgsfield is the exclusive
// image-generation provider, so every image path gates on this rather than on
// any OpenAI key.
export function hasHiggsfieldCredentials(): boolean {
  return Boolean(process.env.HF_CREDENTIALS || process.env.HIGGSFIELD_API_KEY);
}

// HTTP Basic from "key_id:key_secret", else Bearer from HIGGSFIELD_API_KEY.
export function getAuthHeader(): string {
  const creds = process.env.HF_CREDENTIALS;
  if (creds) {
    const encoded = Buffer.from(creds).toString("base64");
    return `Basic ${encoded}`;
  }
  const key = process.env.HIGGSFIELD_API_KEY;
  if (key) return `Bearer ${key}`;
  throw new Error("No Higgsfield credentials configured");
}

export function baseUrl(): string {
  return (process.env.HIGGSFIELD_BASE_URL ?? "https://platform.higgsfield.ai").replace(/\/$/, "");
}

export function webhookConfig(): { url: string; secret: string } | undefined {
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  if (!secret) return undefined;
  return { url: WEBHOOK_URL, secret };
}

// Core request wrapper — POSTs { input, withPolling, webhook } to an endpoint
// and returns the parsed HiggsfieldResponse.
export async function higgsfieldRequest(args: {
  endpoint: string;
  input: Record<string, unknown>;
  withPolling?: boolean;
  webhook?: { url: string; secret: string };
}): Promise<HiggsfieldResponse> {
  const url = `${baseUrl()}${args.endpoint.startsWith("/") ? "" : "/"}${args.endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: args.input,
      withPolling: args.withPolling ?? false,
      webhook: args.webhook ?? undefined,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Higgsfield HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as HiggsfieldResponse;
}

// Maps a Higgsfield production status to our normalized VideoJobStatus union.
function mapStatus(raw: HiggsfieldResponse["status"]): VideoJobStatus["status"] {
  switch (raw) {
    case "completed":
      return "completed";
    case "nsfw":
    case "failed":
      return "failed";
    case "in_progress":
    case "queued":
    default:
      return "processing";
  }
}

export class HiggsfieldProvider implements VideoGenerationProvider {
  readonly name = "higgsfield";

  async submitJob(input: VideoJobInput): Promise<VideoJobResult> {
    if (!process.env.HF_CREDENTIALS && !process.env.HIGGSFIELD_API_KEY) {
      const error = "No Higgsfield credentials configured";
      await this.markVideoFailed(input.postId, error);
      return { success: false, error };
    }

    // Convert the internal job input into an AutoLenis media request.
    const request: AutoLenisAiMediaRequest = {
      provider: "higgsfield",
      generationType: "image_to_video",
      endpoint: "/v1/image2video/dop",
      prompt: input.visualPrompt,
      aspectRatio: "9:16",
      durationSeconds: input.durationSeconds ?? 15,
      model: "dop-turbo",
      socialPostId: input.postId,
    };

    // Build the confirmed Higgsfield input payload.
    const payload: Record<string, unknown> = {
      model: request.model ?? "dop-turbo",
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio ?? "9:16",
      duration: request.durationSeconds ?? 15,
      motion_strength: request.motionStrength ?? 0.8,
      seed: request.seed ?? undefined,
      input_images:
        request.imageUrls?.map((url) => ({ type: "image_url", image_url: url })) ?? [],
    };

    try {
      const response = await higgsfieldRequest({
        endpoint: request.endpoint,
        input: payload,
        withPolling: false,
        webhook: webhookConfig(),
      });

      if (!response.request_id) {
        const error = "Higgsfield response missing request_id";
        await this.markVideoFailed(input.postId, error);
        return { success: false, error };
      }

      // 1. Mirror the job into the AiMediaGeneration tracking table.
      await prisma.aiMediaGeneration.create({
        data: {
          provider: "higgsfield",
          endpoint: request.endpoint,
          generationType: request.generationType,
          prompt: request.prompt,
          inputPayload: { endpoint: request.endpoint, input: payload } as Prisma.InputJsonObject,
          higgsfieldRequestId: response.request_id,
          status: response.status ?? "queued",
          statusUrl: response.status_url,
          cancelUrl: response.cancel_url,
          socialPostId: input.postId,
        },
      });

      // 2. Move the SocialVideo into the generating state.
      await prisma.socialVideo.update({
        where: { postId: input.postId },
        data: {
          providerJobId: response.request_id,
          status: "VIDEO_GENERATING",
          lastPolledAt: new Date(),
          errorMessage: null,
        },
      });

      return { success: true, providerJobId: response.request_id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`[higgsfield] submitJob failed for post ${input.postId}:`, error);
      await this.markVideoFailed(input.postId, error);
      return { success: false, error };
    }
  }

  async getJobStatus(jobId: string): Promise<VideoJobStatus> {
    try {
      // Prefer the status_url captured at submit time, else construct one.
      const tracking = await prisma.aiMediaGeneration.findUnique({
        where: { higgsfieldRequestId: jobId },
      });
      const statusUrl =
        tracking?.statusUrl ?? `${baseUrl()}/v1/status/${jobId}`;

      const res = await fetch(statusUrl, {
        method: "GET",
        headers: { Authorization: getAuthHeader() },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { jobId, status: "failed", error: `Higgsfield HTTP ${res.status}: ${detail.slice(0, 200)}` };
      }

      const response = (await res.json()) as HiggsfieldResponse;
      const mapped = mapStatus(response.status);
      const videoUrl = response.video?.url;
      const thumbnailUrl = response.images?.[0]?.url;
      const isCompleted = response.status === "completed";
      const isNsfw = response.status === "nsfw";

      // Update the tracking record.
      if (tracking) {
        await prisma.aiMediaGeneration.update({
          where: { id: tracking.id },
          data: {
            status: response.status,
            outputVideoUrl: isCompleted ? videoUrl : undefined,
            outputImages: response.images ?? undefined,
            outputRaw: response as unknown as object,
            completedAt: isCompleted ? new Date() : undefined,
            nsfwFlagged: isNsfw ? true : undefined,
            errorMessage: response.status === "failed" ? "Higgsfield reported failure" : undefined,
          },
        });
      }

      // Mirror onto the SocialVideo (idempotent with the cron's own update).
      const video = await prisma.socialVideo.findFirst({ where: { providerJobId: jobId } });
      if (video) {
        await prisma.socialVideo.update({
          where: { id: video.id },
          data: {
            status:
              mapped === "completed"
                ? "VIDEO_READY"
                : mapped === "failed"
                  ? "VIDEO_FAILED"
                  : "VIDEO_GENERATING",
            videoUrl: isCompleted ? videoUrl : undefined,
            thumbnailUrl: isCompleted ? thumbnailUrl : undefined,
            generatedAt: isCompleted ? new Date() : undefined,
            lastPolledAt: new Date(),
            pollAttempts: { increment: 1 },
          },
        });
      }

      return {
        jobId,
        status: mapped,
        videoUrl,
        thumbnailUrl,
        error: response.status === "failed" || isNsfw ? `status: ${response.status}` : undefined,
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

  // Generates a still image (e.g. a vehicle hero shot) and records the job.
  // Returns the provider request_id for downstream polling.
  async generateTextToImage(request: {
    prompt: string;
    aspectRatio?: "9:16" | "16:9" | "1:1";
    socialPostId?: string;
    vehicleId?: string;
    campaignId?: string;
    negativePrompt?: string;
  }): Promise<{ success: boolean; requestId?: string; error?: string }> {
    const endpoint = "flux-pro/kontext/max/text-to-image";
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio ?? "9:16",
      safety_tolerance: 2,
      seed: Math.floor(Math.random() * 99999),
      ...(request.negativePrompt ? { negative_prompt: request.negativePrompt } : {}),
    };

    try {
      const response = await higgsfieldRequest({
        endpoint,
        input,
        withPolling: false,
        webhook: webhookConfig(),
      });

      if (!response.request_id) {
        return { success: false, error: "Higgsfield response missing request_id" };
      }

      await prisma.aiMediaGeneration.create({
        data: {
          provider: "higgsfield",
          endpoint,
          generationType: "text_to_image",
          prompt: request.prompt,
          inputPayload: { endpoint, input } as Prisma.InputJsonObject,
          higgsfieldRequestId: response.request_id,
          status: response.status ?? "queued",
          statusUrl: response.status_url,
          cancelUrl: response.cancel_url,
          socialPostId: request.socialPostId,
          vehicleId: request.vehicleId,
          campaignId: request.campaignId,
        },
      });

      return { success: true, requestId: response.request_id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("[higgsfield] generateTextToImage failed:", error);
      return { success: false, error };
    }
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
