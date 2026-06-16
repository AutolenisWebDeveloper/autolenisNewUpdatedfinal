import { logger } from "@/lib/logger";
// AutoLenis Social Engine — Runway ML Gen-4 Turbo image-to-video provider.
//
// Second stage of the Tier 1 visual pipeline: DALL-E 3 generates a branded
// still, Runway Gen-4 Turbo animates it into a 5-second video, and Buffer
// publishes the result to TikTok / Instagram / YouTube. Facebook + LinkedIn
// stay on static images and never reach this provider.
//
// Defensive throughout: a missing key or an API error yields a typed failure
// result rather than throwing, so the video-generation cron can record the
// reason and move on without blocking the image-only publishing path.

export interface RunwayVideoResult {
  success: boolean;
  videoUrl?: string;
  taskId?: string;
  error?: string;
}

const RUNWAY_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";

function getRunwayHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.RUNWAY_API_KEY ?? ""}`,
    "X-Runway-Version": RUNWAY_VERSION,
    "Content-Type": "application/json",
  };
}

// Platform-specific output ratios (confirmed from Runway docs — exact strings,
// no 16:9 / 9:16 shorthand). Tier 1 platforms render vertical for feeds/Shorts;
// Facebook + LinkedIn (image-only today) would render landscape.
const PLATFORM_RATIO: Record<string, string> = {
  tiktok: "720:1280", // vertical portrait
  instagram: "720:1280", // vertical portrait
  youtube: "720:1280", // vertical for Shorts
  facebook: "1280:720", // landscape
  linkedin: "1280:720", // landscape
};

// Motion prompts per franchise — describe the motion only; the DALL-E still
// already establishes the scene, subject, and brand styling.
const FRANCHISE_MOTION: Record<string, string> = {
  dealer_secret_daily:
    "Slow dramatic zoom in, subtle camera shake, text reveals " +
    "with impact, cinematic tension",
  dealer_fee_breakdown:
    "Smooth pan across the scene, numbers animate in sequence, " +
    "professional corporate motion",
  city_market_alert:
    "Aerial camera slowly descends toward the city, " +
    "dynamic urban energy, morning light",
  vehicle_price_watch:
    "Slow cinematic push toward the vehicle, " +
    "showroom lighting sweep, premium feel",
  buyer_win_story:
    "Warm celebration energy, subtle upward camera movement, " +
    "positive momentum",
  how_autolenis_works:
    "Clean tech animation feel, smooth transitions, " +
    "confident forward motion",
  financing_friday:
    "Professional steady camera, clean minimal motion, " +
    "trustworthy financial aesthetic",
  trade_in_tuesday:
    "Wide to medium shot pull, comparing multiple vehicles, " +
    "decision-making energy",
  autolenis_market_index:
    "Data visualization animation feel, smooth professional " +
    "camera movement, authority",
  auction_countdown:
    "Urgent fast-paced energy, dynamic camera, " +
    "competitive tension building",
  offer_received:
    "Positive reveal motion, envelope opening energy, " +
    "celebration and relief",
  dealer_growth:
    "Upward trending motion, growth energy, " +
    "professional business confidence",
  market_stats_dealer:
    "Clean data presentation motion, professional steady camera, " +
    "analytical precision",
};

interface RunwayCreateResponse {
  id?: string;
  status?: string;
}

interface RunwayTaskResponse {
  id?: string;
  status?: string;
  output?: string[];
  failure?: string;
}

export async function createRunwayVideoTask(input: {
  imageUrl: string;
  platform: string;
  franchise: string;
  hook?: string | null;
}): Promise<{ taskId: string } | { error: string }> {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    return { error: "RUNWAY_API_KEY not configured" };
  }

  const ratio = PLATFORM_RATIO[input.platform.toLowerCase()] ?? "720:1280";
  const motionPrompt =
    FRANCHISE_MOTION[input.franchise] ??
    "Smooth cinematic camera movement, professional automotive content";

  // Build the motion prompt — focused on motion, not scene (the image already
  // carries the scene). Capped to Runway's prompt length limit.
  const promptText =
    `${motionPrompt}. ` +
    `Automotive content. Professional quality. ` +
    `No text overlays. No watermarks. Cinematic.`;

  try {
    const res = await fetch(`${RUNWAY_BASE}/v1/image_to_video`, {
      method: "POST",
      headers: getRunwayHeaders(),
      body: JSON.stringify({
        model: "gen4_turbo",
        promptImage: input.imageUrl,
        promptText: promptText.slice(0, 500), // Runway prompt limit
        ratio,
        duration: 5,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logger.error("[runway] task creation failed:", res.status, err);
      return {
        error: `Runway API ${res.status}: ${JSON.stringify(err).slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as RunwayCreateResponse;
    const taskId = data?.id;

    if (!taskId) {
      return { error: "No task ID in Runway response" };
    }

    logger.info("[runway] task created:", taskId, "platform:", input.platform);
    return { taskId };
  } catch (err) {
    logger.error("[runway] task creation error:", err);
    return {
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function pollRunwayTask(taskId: string): Promise<RunwayVideoResult> {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) return { success: false, error: "RUNWAY_API_KEY not configured" };

  const MAX_POLLS = 30; // 30 × 10s = 5 minutes max
  let attempts = 0;

  while (attempts < MAX_POLLS) {
    try {
      const res = await fetch(`${RUNWAY_BASE}/v1/tasks/${taskId}`, {
        headers: getRunwayHeaders(),
      });

      if (!res.ok) {
        logger.error("[runway] poll failed:", res.status);
        return { success: false, taskId, error: `Poll HTTP ${res.status}` };
      }

      const data = (await res.json()) as RunwayTaskResponse;
      const status = data?.status;

      if (status === "SUCCEEDED") {
        const videoUrl = data?.output?.[0];
        if (!videoUrl) {
          return { success: false, taskId, error: "No video URL in response" };
        }
        logger.info("[runway] ✅ task succeeded:", taskId);
        return { success: true, videoUrl, taskId };
      }

      if (status === "FAILED") {
        const reason = data?.failure ?? "Unknown failure";
        logger.error("[runway] ❌ task failed:", taskId, reason);
        return { success: false, taskId, error: reason };
      }

      // PENDING or RUNNING — wait and poll again.
      logger.info(
        `[runway] task ${taskId} status: ${status}`,
        `(attempt ${attempts + 1}/${MAX_POLLS})`,
      );
      attempts++;

      // Wait 10 seconds between polls.
      await new Promise((r) => setTimeout(r, 10000));
    } catch (err) {
      logger.error("[runway] poll error:", err);
      return {
        success: false,
        taskId,
        error: err instanceof Error ? err.message : "Poll error",
      };
    }
  }

  return {
    success: false,
    taskId,
    error: `Timeout after ${MAX_POLLS} poll attempts`,
  };
}

// Convenience: create the task then poll it to completion. Returns the resolved
// video URL or a typed failure.
export async function generateRunwayVideo(input: {
  imageUrl: string;
  platform: string;
  franchise: string;
  hook?: string | null;
}): Promise<RunwayVideoResult> {
  const taskResult = await createRunwayVideoTask(input);

  if ("error" in taskResult) {
    return { success: false, error: taskResult.error };
  }

  return pollRunwayTask(taskResult.taskId);
}
