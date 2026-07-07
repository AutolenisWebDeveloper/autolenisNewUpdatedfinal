// Unit tests for the typed API client (lib/api/client.ts).
//
// Run with: npx tsx --test lib/api/__tests__/client.test.ts

import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, apiErrorMessage } from "../client";

function stubFetch(status: number, body: unknown) {
  mock.method(globalThis, "fetch", async () =>
    new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => mock.restoreAll());

test("unwraps { success, data } and returns the payload directly", async () => {
  stubFetch(200, { success: true, data: { auction: { id: "a1" }, count: 3 } });
  const result = await api.get<{ auction: { id: string }; count: number }>("/api/dealer/auctions/a1");
  // The depth bug is impossible: callers read result.auction, not result.data.auction.
  assert.equal(result.auction.id, "a1");
  assert.equal(result.count, 3);
});

test("throws ApiError carrying the server's code + message on error envelope", async () => {
  stubFetch(409, { error: { code: "AUCTION_LIVE", message: "Auction still running" }, correlationId: "c1" });
  await assert.rejects(
    () => api.post("/api/buyer/auctions/a1/select-offer", { offerId: "o1" }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "AUCTION_LIVE");
      assert.equal(err.message, "Auction still running");
      assert.equal(err.status, 409);
      assert.equal(err.correlationId, "c1");
      return true;
    },
  );
});

test("throws on a non-JSON / empty error body without crashing", async () => {
  stubFetch(500, undefined);
  await assert.rejects(() => api.get("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
    return true;
  });
});

test("throws when success flag is absent even on a 200", async () => {
  stubFetch(200, { data: { x: 1 } }); // missing success:true
  await assert.rejects(() => api.get("/api/x"));
});

test("apiErrorMessage extracts a user-facing string", () => {
  assert.equal(apiErrorMessage(new ApiError("X", "boom", 400)), "boom");
  assert.equal(apiErrorMessage(new Error("raw")), "raw");
  assert.equal(apiErrorMessage("weird"), "Something went wrong. Please try again.");
});
