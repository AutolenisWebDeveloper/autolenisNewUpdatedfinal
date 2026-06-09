// AutoLenis Social Engine — Instagram/LinkedIn Carousel Generator.
//
// Produces branded square (1080×1080) carousel slides for a social post. The
// post script is distilled into 5 short bullet points via Groq, each rendered
// as an SVG slide with the AutoLenis gradient + branding, rasterized to PNG with
// sharp, and uploaded to Supabase storage. Returns the public slide URLs.
//
// Defensive throughout: a Groq/sharp/storage failure logs and returns whatever
// slides succeeded (possibly an empty array) rather than throwing.

import "server-only";
import sharp from "sharp";
import type { ContentFranchise, SocialPost } from "@prisma/client";
import { GROQ_SUMMARY } from "@/lib/ai/acquisition";
import { getServiceSupabase } from "@/lib/supabase-service";

const STORAGE_BUCKET = "social-media-assets";
const SIZE = 1080;
const BRAND_BLUE = "#0B5FD1";
const BRAND_BLUE_DARK = "#0a4ba8";

export interface CarouselInput {
  post: SocialPost;
  franchise: ContentFranchise;
}

// ─── Groq: extract 5 bullet points ───────────────────────────────────────────
async function extractBullets(script: string): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_SUMMARY,
      messages: [
        {
          role: "system",
          content:
            "You extract concise carousel bullet points for social media. Return ONLY a JSON array of strings. No markdown.",
        },
        {
          role: "user",
          content: `Extract 5 key bullet points from this script. Each bullet max 10 words. Return as JSON array.\n\nScript:\n${script}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.5,
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = (data.choices?.[0]?.message?.content ?? "").trim();
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  const json = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Groq did not return an array");
  return parsed
    .map((b) => (typeof b === "string" ? b.trim() : String(b ?? "").trim()))
    .filter(Boolean)
    .slice(0, 5);
}

// ─── SVG rendering ────────────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Greedy word-wrap into lines of at most `maxChars` characters.
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildSlideSvg(text: string, index: number, total: number): string {
  const lines = wrapText(text, 22);
  const lineHeight = 96;
  const startY = SIZE / 2 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${SIZE / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND_BLUE}"/>
      <stop offset="100%" stop-color="${BRAND_BLUE_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <text x="64" y="84" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#FFFFFF">AutoLenis</text>
  <text x="${SIZE - 64}" y="84" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="600" fill="#FFFFFF" opacity="0.85">${index + 1}/${total}</text>
  <text text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800" fill="#FFFFFF">${tspans}</text>
  <text x="${SIZE / 2}" y="${SIZE - 56}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="600" fill="#FFFFFF" opacity="0.85">autolenis.com</text>
</svg>`;
}

async function uploadSlide(png: Buffer, postId: string, n: number): Promise<string> {
  const supabase = getServiceSupabase();
  const path = `social-posts/${postId}/carousel-${n}.png`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`supabase upload failed: ${error.message}`);
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("supabase getPublicUrl returned no url");
  return data.publicUrl;
}

// Generates branded carousel slides for a post and returns their public URLs.
// Returns [] if bullet extraction fails entirely; otherwise returns the slides
// that rendered + uploaded successfully.
export async function generateCarouselSlides(input: CarouselInput): Promise<string[]> {
  const { post } = input;

  let bullets: string[];
  try {
    bullets = await extractBullets(post.script);
  } catch (err) {
    console.error("[carousel] bullet extraction failed:", err);
    return [];
  }
  if (bullets.length === 0) return [];

  const urls: string[] = [];
  for (let i = 0; i < bullets.length; i++) {
    try {
      const svg = buildSlideSvg(bullets[i], i, bullets.length);
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const url = await uploadSlide(png, post.id, i + 1);
      urls.push(url);
    } catch (err) {
      console.error(`[carousel] slide ${i + 1} failed (non-fatal):`, err);
    }
  }
  return urls;
}
