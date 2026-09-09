// Unit tests for the typed API client (lib/api/client.ts).
//
// Run with: npx tsx --test lib/api/__tests__/client.test.ts

import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, apiErrorMessage, classifyIntakeResponse, submitVehicleRequest } from "../client";

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

// ── The public intake contract ──────────────────────────────────────────────
//
// The defect these pin: POST /api/public/request-vehicle answers three
// materially different things with the same 200, and `success: true` is set for
// all three. Every assertion below is a case a caller previously read as "the
// request is in".

test("classify: a vehicleRequestId is the ONLY thing that makes a submission persisted", () => {
  const out = classifyIntakeResponse({
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: "vr1",
    requiresClaim: false,
  });
  assert.equal(out.kind, "persisted");
  assert.equal(out.kind === "persisted" && out.vehicleRequestId, "vr1");
  assert.equal(out.kind === "persisted" && out.draft, false);
});

test("classify: requiresClaim WITH a request is still persisted — a guest capture", () => {
  // The exact misreading that told first-time visitors their address already had
  // an account: `requiresClaim` is set for ordinary guest captures too.
  const out = classifyIntakeResponse({
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: "vr1",
    requiresClaim: true,
    claimLinkSent: false,
  });
  assert.equal(out.kind, "persisted");
});

test("classify: a draft capture is persisted and says so", () => {
  const out = classifyIntakeResponse({
    success: true,
    draft: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: "vr1",
    requiresClaim: true,
  });
  assert.equal(out.kind === "persisted" && out.draft, true);
});

test("classify: nothing attached AND a link sent is claim_sent, carrying the server's message", () => {
  const out = classifyIntakeResponse({
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: null,
    requiresClaim: true,
    claimLinkSent: true,
    message: "We sent a link to that email address.",
  });
  assert.equal(out.kind, "claim_sent");
  assert.equal(out.kind === "claim_sent" && out.message, "We sent a link to that email address.");
});

test("classify: nothing attached and NO link sent is held, never claim_sent", () => {
  // A registered user with no buyer row: there is nothing to mint a token
  // against, so the surface must not promise an email.
  const out = classifyIntakeResponse({
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: null,
    requiresClaim: true,
    claimLinkSent: false,
    message: "We have your details and a member of our team will follow up shortly.",
  });
  assert.equal(out.kind, "held");
});

test("classify: an absent claimLinkSent is read as NOT sent", () => {
  // Safe direction on an older server: promise less, never more.
  const out = classifyIntakeResponse({
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: null,
    requiresClaim: true,
  });
  assert.equal(out.kind, "held");
});

test("classify: a capture with no claim at all is held", () => {
  const out = classifyIntakeResponse({
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: null,
    requiresClaim: false,
  });
  assert.equal(out.kind, "held");
});

test("classify: a 200 with no lead id is an error, not a success", () => {
  assert.throws(() => classifyIntakeResponse({ success: true, vehicleRequestId: null }), ApiError);
});

test("submitVehicleRequest: a 200 held capture resolves as held, never as an error", async () => {
  stubFetch(200, {
    success: true,
    buyerOpportunityId: "op1",
    vehicleRequestId: null,
    requiresClaim: true,
    claimLinkSent: true,
    message: "check your email",
  });
  const out = await submitVehicleRequest({ email: "x@example.invalid" });
  assert.equal(out.kind, "claim_sent");
});

test("submitVehicleRequest: a non-2xx throws ApiError carrying the server message", async () => {
  stubFetch(429, { success: false, error: { code: "RATE_LIMITED", message: "Too many requests." } });
  await assert.rejects(
    () => submitVehicleRequest({ email: "x@example.invalid" }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "RATE_LIMITED");
      assert.equal(err.status, 429);
      return true;
    },
  );
});

test("submitVehicleRequest: success:false on a 200 still throws", async () => {
  stubFetch(200, { success: false, error: { message: "nope" } });
  await assert.rejects(() => submitVehicleRequest({ email: "x@example.invalid" }), ApiError);
});
