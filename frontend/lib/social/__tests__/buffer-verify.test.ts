// Live Buffer connection verification (verifyBufferConnection).
// Run with:
//   npx tsx --test lib/social/__tests__/buffer-verify.test.ts
//
// Proves the admin "Test Buffer Connection" path: it validates the API key via
// the account query, lists channels per organization, and cross-references each
// configured BUFFER_PROFILE_* id against the real channels (matched vs missing).

import test from "node:test";
import assert from "node:assert/strict";
import { verifyBufferConnection } from "../providers/buffer.provider";

// Body-aware fetch stub: the account and channels queries hit the same Buffer
// GraphQL URL, so we branch on the GraphQL query text in the request body.
function stubBufferFetch(): () => void {
  const original = global.fetch;
  global.fetch = (async (_input: unknown, init?: { body?: string }) => {
    const body = init?.body ?? "";
    let data: unknown;
    if (body.includes("GetAccount")) {
      data = { account: { organizations: [{ id: "org_1", name: "AutoLenis" }] } };
    } else if (body.includes("GetChannels")) {
      data = {
        channels: [
          { id: "fb_123", name: "AutoLenis FB", service: "facebook" },
          { id: "ig_456", name: "AutoLenis IG", service: "instagram" },
        ],
      };
    } else {
      data = {};
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data }),
      text: async () => JSON.stringify({ data }),
      headers: { get: () => null },
    };
  }) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}

test("verifyBufferConnection: validates key, lists channels, matches configured ids", async () => {
  process.env.ENABLE_BUFFER_PUBLISHING = "true";
  process.env.BUFFER_API_KEY = "test-key";
  process.env.BUFFER_PROFILE_FACEBOOK = "fb_123"; // matches a real channel
  process.env.BUFFER_PROFILE_INSTAGRAM = "ig_WRONG"; // configured but stale
  delete process.env.BUFFER_PROFILE_TIKTOK; // not configured

  const restore = stubBufferFetch();
  try {
    const res = await verifyBufferConnection();

    assert.equal(res.apiKeyPresent, true);
    assert.equal(res.apiKeyValid, true);
    assert.equal(res.enabled, true);
    assert.equal(res.channels.length, 2);
    assert.deepEqual(
      res.organizations.map((o) => o.id),
      ["org_1"],
    );

    const fb = res.configured.find((c) => c.platform === "facebook")!;
    assert.equal(fb.present, true);
    assert.equal(fb.matched, true);
    assert.equal(fb.channelName, "AutoLenis FB");

    const ig = res.configured.find((c) => c.platform === "instagram")!;
    assert.equal(ig.present, true);
    assert.equal(ig.matched, false); // configured id not found in Buffer

    const tiktok = res.configured.find((c) => c.platform === "tiktok")!;
    assert.equal(tiktok.present, false);
    assert.equal(tiktok.matched, false);
  } finally {
    restore();
  }
});

test("verifyBufferConnection: missing API key reports invalid without a network call", async () => {
  process.env.ENABLE_BUFFER_PUBLISHING = "true";
  delete process.env.BUFFER_API_KEY;

  const original = global.fetch;
  let called = false;
  global.fetch = (async () => {
    called = true;
    throw new Error("should not be called");
  }) as unknown as typeof fetch;
  try {
    const res = await verifyBufferConnection();
    assert.equal(res.apiKeyPresent, false);
    assert.equal(res.apiKeyValid, false);
    assert.equal(called, false);
    assert.match(res.error ?? "", /BUFFER_API_KEY/);
  } finally {
    global.fetch = original;
  }
});
