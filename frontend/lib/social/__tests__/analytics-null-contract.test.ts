// Null-vs-zero degradation contract for native platform analytics.
// Run with:
//   npx tsx --test lib/social/__tests__/analytics-null-contract.test.ts
//
// Proves that an *unavailable* metric surfaces as null (not a fabricated 0) at
// the provider boundary AND survives the sync route's persistence mapping
// (mapAnalyticsToPerformanceMetrics) as null end-to-end. A 0 is reserved for a
// value the platform API confirmed is zero.

import test from "node:test";
import assert from "node:assert/strict";
import { MetaProvider } from "../providers/meta.provider";
import { TikTokProvider } from "../providers/tiktok.provider";
import { LinkedInProvider } from "../providers/linkedin.provider";
import { mapAnalyticsToPerformanceMetrics } from "../analytics-mapping";

// ── Minimal fetch stub ───────────────────────────────────────────────────────
interface StubResponse {
  ok?: boolean;
  status?: number;
  body?: unknown;
}
function stubFetch(handler: (url: string) => StubResponse): () => void {
  const original = global.fetch;
  global.fetch = (async (input: unknown) => {
    const r = handler(String(input));
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
      headers: { get: () => null },
    };
  }) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}

// ── TikTok: Display API exposes only like/comment/share/view ─────────────────
test("TikTok: watch/profile/reach metrics are null without a Business token", async () => {
  process.env.TIKTOK_ACCESS_TOKEN = "test-token";
  delete process.env.TIKTOK_BUSINESS_ACCESS_TOKEN;
  delete process.env.TIKTOK_BUSINESS_ID;

  const restore = stubFetch((url) => {
    if (url.includes("/video/query/")) {
      return {
        body: {
          data: {
            videos: [
              { id: "v1", like_count: 10, comment_count: 2, share_count: 1, view_count: 100 },
            ],
          },
        },
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  try {
    const a = await new TikTokProvider().getAnalytics("v1");

    // Confirmed values from the Display API.
    assert.equal(a.likes, 10);
    assert.equal(a.comments, 2);
    assert.equal(a.shares, 1);
    assert.equal(a.views, 100);

    // Unavailable on the Display API → null, never fabricated.
    assert.equal(a.reach, null);
    assert.equal(a.clicks, null);
    assert.equal(a.completionRate, null);
    assert.equal(a.watchTimeSeconds, null);
    assert.equal(a.profileVisits, null);
    assert.equal(a.follows, null);

    // End-to-end through the sync route mapping.
    const row = mapAnalyticsToPerformanceMetrics(a);
    assert.equal(row.reach, null);
    assert.equal(row.linkClicks, null);
    assert.equal(row.completionRate, null);
    assert.equal(row.watchTimePct, null); // never average watch-time seconds
    assert.equal(row.profileVisits, null);
    assert.equal(row.likes, 10);
    assert.equal(row.views, 100);
  } finally {
    restore();
  }
});

// ── LinkedIn member endpoint: only like + comment counts ─────────────────────
test("LinkedIn: shares/clicks/reach/impressions are null on the member endpoint", async () => {
  process.env.LINKEDIN_ACCESS_TOKEN = "test-token";

  const restore = stubFetch((url) => {
    if (url.includes("/socialActions/")) {
      return {
        body: {
          likesSummary: { totalLikes: 7 },
          commentsSummary: { totalFirstLevelComments: 3 },
        },
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  try {
    const a = await new LinkedInProvider().getAnalytics("urn:li:share:123");
    assert.equal(a.likes, 7);
    assert.equal(a.comments, 3);
    assert.equal(a.shares, null);
    assert.equal(a.clicks, null);
    assert.equal(a.reach, null);
    assert.equal(a.impressions, null);

    const row = mapAnalyticsToPerformanceMetrics(a);
    assert.equal(row.shares, null);
    assert.equal(row.linkClicks, null);
    assert.equal(row.reach, null);
    assert.equal(row.impressions, null);
    assert.equal(row.likes, 7);
  } finally {
    restore();
  }
});

test("LinkedIn: a 403 yields all-null core metrics", async () => {
  process.env.LINKEDIN_ACCESS_TOKEN = "test-token";
  const restore = stubFetch(() => ({ ok: false, status: 403, body: {} }));
  try {
    const a = await new LinkedInProvider().getAnalytics("urn:li:share:123");
    for (const v of [a.likes, a.comments, a.shares, a.clicks, a.reach]) {
      assert.equal(v, null);
    }
  } finally {
    restore();
  }
});

// ── Meta Instagram: deprecated impressions dropped, views canonical ──────────
test("Meta IG: impressions is null (deprecated), views is the visibility metric", async () => {
  process.env.META_ACCESS_TOKEN = "test-token";
  delete process.env.META_INSTAGRAM_ACCOUNT_ID; // skip audience fetch

  const restore = stubFetch((url) => {
    if (url.includes("/insights")) {
      return {
        body: {
          data: [
            { name: "reach", values: [{ value: 500 }] },
            { name: "likes", values: [{ value: 40 }] },
            { name: "comments", values: [{ value: 5 }] },
            { name: "shares", values: [{ value: 2 }] },
            { name: "saved", values: [{ value: 8 }] },
            { name: "views", values: [{ value: 900 }] },
            { name: "total_interactions", values: [{ value: 55 }] },
          ],
        },
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  try {
    const a = await new MetaProvider().getAnalytics("17900000000000000", "instagram");
    assert.equal(a.impressions, null); // deprecated for API users → unavailable
    assert.equal(a.views, 900); // canonical visibility metric
    assert.equal(a.reach, 500);
    assert.equal(a.saves, 8);
    assert.equal(a.clicks, null); // IG organic has no link-click metric

    const row = mapAnalyticsToPerformanceMetrics(a);
    assert.equal(row.impressions, null);
    assert.equal(row.views, 900);
    assert.equal(row.linkClicks, null);
  } finally {
    restore();
  }
});

// ── Confirmed-zero is preserved as 0 (not coerced to null) ───────────────────
test("Confirmed zero from the API is stored as 0, not null", async () => {
  process.env.META_ACCESS_TOKEN = "test-token";
  delete process.env.META_INSTAGRAM_ACCOUNT_ID;

  const restore = stubFetch(() => ({
    body: {
      data: [
        { name: "reach", values: [{ value: 0 }] },
        { name: "likes", values: [{ value: 0 }] },
        { name: "views", values: [{ value: 0 }] },
      ],
    },
  }));
  try {
    const a = await new MetaProvider().getAnalytics("17900000000000000", "instagram");
    assert.equal(a.likes, 0); // confirmed zero, present in the response
    assert.equal(a.reach, 0);
    const row = mapAnalyticsToPerformanceMetrics(a);
    assert.equal(row.likes, 0);
    assert.equal(row.reach, 0);
  } finally {
    restore();
  }
});
