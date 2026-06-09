// AutoLenis Social Engine — Higgsfield request/response types.
//
// AutoLenisAiMediaRequest is our internal, provider-agnostic-ish request shape;
// the provider maps it onto the confirmed Higgsfield production payload.
// HiggsfieldResponse mirrors the confirmed production response field names used
// by both the submit/poll calls and the webhook receiver.

export type AutoLenisAiMediaRequest = {
  provider: "higgsfield";
  generationType: "text_to_image" | "image_to_video" | "speech_to_video";
  endpoint: string;
  prompt: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  durationSeconds?: number;
  imageUrls?: string[];
  audioUrl?: string;
  model?: string;
  motionStrength?: number;
  seed?: number;
  socialPostId?: string;
  vehicleId?: string;
  campaignId?: string;
};

export type HiggsfieldResponse = {
  status: "queued" | "in_progress" | "nsfw" | "failed" | "completed";
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  images?: { url: string }[];
  video?: { url: string };
};
