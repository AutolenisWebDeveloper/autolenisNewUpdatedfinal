// Regression tests for the publishing provider factory AFTER Buffer retirement.
// Proves: (1) retained channels select their DIRECT provider when the access
// token is configured; (2) with no token they get an explicit-failure no-op
// (never a fabricated success, never a Buffer/third-party fallback); (3) YouTube
// publishing is retired (explicit failure) while its analytics still degrade
// truthfully; (4) NO Buffer provider is ever returned and nothing imports the
// deleted buffer.provider module.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/social/__tests__/publishing-factory.test.ts"

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getPublishingProvider } from "@/lib/social/providers/publishing.factory";

const TOKENS = ["META_ACCESS_TOKEN", "TIKTOK_ACCESS_TOKEN", "LINKEDIN_ACCESS_TOKEN", "YOUTUBE_API_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const t of TOKENS) { saved[t] = process.env[t]; delete process.env[t]; }
});
afterEach(() => {
  for (const t of TOKENS) {
    if (saved[t] === undefined) delete process.env[t];
    else process.env[t] = saved[t];
  }
});

test("facebook/instagram → MetaProvider when META_ACCESS_TOKEN is set", () => {
  process.env.META_ACCESS_TOKEN = "tok";
  assert.equal(getPublishingProvider("facebook").name, "meta");
  assert.equal(getPublishingProvider("instagram").name, "meta");
});

test("tiktok/linkedin → direct provider when their token is set", () => {
  process.env.TIKTOK_ACCESS_TOKEN = "tok";
  process.env.LINKEDIN_ACCESS_TOKEN = "tok";
  assert.equal(getPublishingProvider("tiktok").name, "tiktok");
  assert.equal(getPublishingProvider("linkedin").name, "linkedin");
});

test("an unconfigured retained channel gets an explicit-failure no-op (not Buffer)", async () => {
  for (const platform of ["facebook", "instagram", "tiktok", "linkedin"]) {
    const provider = getPublishingProvider(platform);
    assert.equal(provider.name, "noop", `${platform} → noop when no direct token`);
    const res = await provider.publishNow({ postId: "p", platform, caption: "", hashtags: [] });
    assert.equal(res.success, false, `${platform} publish fails explicitly`);
    assert.notEqual(provider.name, "buffer");
  }
});

test("unknown platform → explicit-failure no-op", async () => {
  const provider = getPublishingProvider("myspace");
  assert.equal(provider.name, "noop");
  const res = await provider.publishNow({ postId: "p", platform: "myspace", caption: "", hashtags: [] });
  assert.equal(res.success, false);
});

test("youtube → YouTubeProvider; publishing is retired (explicit failure)", async () => {
  const provider = getPublishingProvider("youtube");
  assert.equal(provider.name, "youtube");
  const sched = await provider.schedulePost({ postId: "p", platform: "youtube", caption: "", hashtags: [], scheduledAt: new Date(0) });
  assert.equal(sched.success, false);
  assert.match(sched.error ?? "", /retired/i);
  const pub = await provider.publishNow({ postId: "p", platform: "youtube", caption: "", hashtags: [] });
  assert.equal(pub.success, false);
  assert.match(pub.error ?? "", /retired/i);
});

test("youtube analytics degrade truthfully (no fabricated data) when unconfigured", async () => {
  const provider = getPublishingProvider("youtube");
  const analytics = await provider.getAnalytics("vid123");
  // Unavailable metrics are null (not fabricated zeros) and an error is surfaced.
  assert.equal(analytics.likes, null);
  assert.equal(analytics.reach, null);
  assert.match(analytics.error ?? "", /YOUTUBE_API_KEY/);
});

test("no Buffer provider is reachable and no source imports the deleted module", () => {
  // The factory never returns a provider named 'buffer'.
  for (const platform of ["facebook", "instagram", "tiktok", "linkedin", "youtube", "unknown"]) {
    assert.notEqual(getPublishingProvider(platform).name, "buffer");
  }
  // Static proof: the buffer.provider module file is gone and no provider imports it.
  const providersDir = path.dirname(fileURLToPath(new URL("../providers/publishing.factory.ts", import.meta.url)));
  const files = readdirSync(providersDir);
  assert.ok(!files.includes("buffer.provider.ts"), "buffer.provider.ts is deleted");
  for (const f of files.filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(path.join(providersDir, f), "utf8");
    assert.ok(!/buffer\.provider|BufferProvider/.test(src), `${f} must not reference the Buffer provider`);
  }
});
