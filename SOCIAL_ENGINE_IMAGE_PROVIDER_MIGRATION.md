# Social Engine — Image Provider Migration & Media-Stack Audit

Replaces all OpenAI/DALL-E image generation with **Higgsfield as the exclusive
image-generation provider**, and documents the audited media/provider stack and
content-generation controls.

## Final provider architecture

| Capability | Provider |
|---|---|
| **Image generation** | **Higgsfield (exclusive)** |
| Video generation | Runway (Gen-4 Turbo) |
| Publishing & scheduling | Buffer |
| Content generation (captions, hooks, scripts, hashtags, copy, strategy) | Claude / OpenAI / Groq |

Supported platforms: Facebook, Instagram, LinkedIn, TikTok, YouTube.

## What changed — OpenAI image generation removed

Every OpenAI/DALL-E image-generation dependency, API call, prompt route,
fallback, DB reference, UI label, and background-job branch was removed or
repointed at Higgsfield.

| Area | File | Change |
|---|---|---|
| Provider | `lib/social/providers/dalle.provider.ts` | **Deleted** (OpenAI Images API, `gpt-image-1`/`dall-e-*`). |
| Provider | `lib/social/providers/higgsfield-image.provider.ts` | **New** `generateHiggsfieldImage()` — branded prompt builder + Higgsfield text-to-image with inline/poll resolution. Mirrors the old provider's contract (returns a hosted URL). |
| Provider helpers | `lib/social/providers/higgsfield.provider.ts` | Exported shared internals (`getAuthHeaders`, `baseUrl`, `higgsfieldRequest`, `webhookConfig`) and added `hasHiggsfieldCredentials()`. |
| Service | `lib/social/image-generation.service.ts` | `generateDallePostImage` → `generateHiggsfieldPostImage`; provider tag `dalle3` → `higgsfield`; removed `OPENAI_API_KEY` routing and the base64/`gpt-image-1` helper; `generatePostVisuals` now gates on `hasHiggsfieldCredentials()`. |
| Admin route | `app/api/admin/social/generate-images/route.ts` | Batch generation now uses Higgsfield; credential gate + DB provider tag updated; base64 path removed. |
| Admin route | `app/api/admin/social/compose/generate-preview-image/route.ts` | Preview generation now uses Higgsfield; gate updated. |
| Cron | `app/api/cron/social-video-queue/route.ts` | Image backfill now uses `generateHiggsfieldPostImage`; `useOpenAI` branch removed; failure records tagged `higgsfield`. |
| Triggers | `social-generate` cron, `compose`, `repost`, `publish-all` | Image-generation trigger gates changed from `OPENAI_API_KEY` → `hasHiggsfieldCredentials()`. |
| UI / prompt | `app/api/admin/social/compose/ai-generate/route.ts` | "DALL-E image generation prompt" label → provider-neutral "image generation prompt". |
| Comments | `runway.provider.ts`, `social-video-generate` cron | "DALL-E still" → "Higgsfield still". |
| Env | `frontend/env.d.ts` | Added `HIGGSFIELD_IMAGE_ENDPOINT`. `OPENAI_API_KEY` retained — now used **only** by Whisper voice STT, not image generation. |

`OPENAI_API_KEY` remains referenced solely in `lib/voice/whisper-stt.service.ts`
(speech-to-text for the voice receptionist) — unrelated to image generation.

## Content-generation & scheduling controls (audited)

The generation engine is **bounded and idempotent** — it cannot generate
unlimited posts:

- `lib/social/config.ts → DAILY_POST_TARGETS` caps volume at **25 posts/day,
  5 per platform** across the 5 supported platforms.
- `app/api/cron/social-generate` counts each platform's posts created today
  (`status ≠ REJECTED`) and only tops up to the per-platform cap, re-checking
  the cap **inside** the generation loop — so repeated cron invocations are
  idempotent and cannot overflow the schedule or flood the queue.
- Signals are drawn from the bounded `daily-signal.generator` rather than the
  unbounded `topic_signals` backlog, preventing runaway loops.
- Per-platform peak post times (`PLATFORM_POST_TIMES`) + `getOptimalSlot`
  spread posts across publishing windows; the orchestrator adds cross-platform
  stagger. Duplicate-publish protection is enforced atomically in the
  publish orchestrator (`publishApprovedPost` claim-by-`updateMany`).

## Verification

- **ESLint:** clean on all touched files.
- **TypeScript (`tsc --noEmit`):** could not be executed in this sandbox — the
  Prisma client could not be generated because the Prisma engine binary
  download host is blocked by the environment's egress policy. Changes reuse
  existing Prisma models/fields and existing function contracts; no schema or
  Prisma-type changes were made. Run `pnpm typecheck` in CI to confirm.
