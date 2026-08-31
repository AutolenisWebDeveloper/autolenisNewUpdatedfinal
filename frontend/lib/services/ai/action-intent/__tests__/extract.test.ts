// The proposal extractor — the single step that was missing between the model
// and the deterministic ActionIntent spine.
//
// The most important assertions here are NEGATIVE: what the extractor refuses to
// carry out of model text. `actor` and `idempotencyKey` are asserted at the TYPE
// boundary (via @ts-expect-error, which `pnpm typecheck` enforces) as well as at
// runtime, because a runtime-only guarantee can be undone by one careless spread
// at a call site, while a type-level one cannot.
//
//   pnpm test:action-intent

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractProposal,
  INTENT_ENVELOPE_OPEN,
  INTENT_ENVELOPE_CLOSE,
  MAX_RATIONALE_LENGTH,
} from "../extract";

function envelope(json: string): string {
  return `${INTENT_ENVELOPE_OPEN}\n${json}\n${INTENT_ENVELOPE_CLOSE}`;
}

// ─── The type boundary ───────────────────────────────────────────────────────

test("TYPE BOUNDARY: the extracted proposal has no `actor` field", () => {
  const result = extractProposal(
    `Here you go.\n${envelope('{"intentType":"buyer.get_journey_status","parameters":{}}')}`,
  );
  assert.ok(result);
  // @ts-expect-error — `actor` is structurally absent from ExtractedProposal.
  // If this ever compiles, the extractor has become able to name an actor and
  // the compile-time guarantee described in extract.ts is gone.
  const leaked = result.proposal.actor;
  assert.equal(leaked, undefined);
});

test("TYPE BOUNDARY: the extracted proposal has no `idempotencyKey` field", () => {
  const result = extractProposal(
    envelope('{"intentType":"buyer.get_journey_status","parameters":{}}'),
  );
  assert.ok(result);
  // @ts-expect-error — a model-authored idempotency key is a read primitive
  // against another actor's intent record; it must be minted server-side.
  const leaked = result.proposal.idempotencyKey;
  assert.equal(leaked, undefined);
});

// ─── Runtime refusals ────────────────────────────────────────────────────────

test("an `actor` supplied inside the envelope is DROPPED, not carried", () => {
  const result = extractProposal(
    envelope(
      '{"intentType":"admin.trigger_deposit_refund","parameters":{"depositId":"d1"},' +
        '"actor":{"actorType":"ADMIN","actorId":"admin-1","authenticatedRole":"SUPER_ADMIN"}}',
    ),
  );
  assert.ok(result);
  assert.deepEqual(Object.keys(result.proposal).sort(), ["intentType", "parameters"]);
  assert.equal((result.proposal as Record<string, unknown>).actor, undefined);
});

test("an `idempotencyKey` supplied inside the envelope is DROPPED, not carried", () => {
  const result = extractProposal(
    envelope(
      '{"intentType":"buyer.get_journey_status","parameters":{},"idempotencyKey":"someone-elses-key"}',
    ),
  );
  assert.ok(result);
  assert.equal((result.proposal as Record<string, unknown>).idempotencyKey, undefined);
});

test("a reply with no envelope proposes nothing", () => {
  assert.equal(extractProposal("Your auction closes Thursday. Anything else?"), null);
});

test("empty and non-string input propose nothing", () => {
  assert.equal(extractProposal(""), null);
  assert.equal(extractProposal(undefined as unknown as string), null);
  assert.equal(extractProposal(null as unknown as string), null);
});

test("TWO envelopes propose NOTHING — one proposal per turn, never a batch", () => {
  const two =
    envelope('{"intentType":"buyer.get_journey_status","parameters":{}}') +
    "\nand also\n" +
    envelope('{"intentType":"buyer.select_offer","parameters":{"offerId":"o1"}}');
  assert.equal(
    extractProposal(two),
    null,
    "a prompt-injected reply must not fan one turn out into a batch of actions",
  );
});

test("an unterminated envelope proposes nothing", () => {
  assert.equal(
    extractProposal(`${INTENT_ENVELOPE_OPEN}\n{"intentType":"buyer.get_journey_status"}`),
    null,
  );
});

test("a close before an open proposes nothing", () => {
  assert.equal(
    extractProposal(`${INTENT_ENVELOPE_CLOSE}\n{}\n${INTENT_ENVELOPE_OPEN}`),
    null,
  );
});

test("malformed JSON proposes nothing — it is refused, never repaired", () => {
  assert.equal(extractProposal(envelope('{"intentType": "buyer.get_journey')), null);
});

test("a non-object payload proposes nothing", () => {
  assert.equal(extractProposal(envelope('"buyer.get_journey_status"')), null);
  assert.equal(extractProposal(envelope("[1,2,3]")), null);
  assert.equal(extractProposal(envelope("null")), null);
});

test("a missing or non-string intentType proposes nothing", () => {
  assert.equal(extractProposal(envelope('{"parameters":{}}')), null);
  assert.equal(extractProposal(envelope('{"intentType":42,"parameters":{}}')), null);
  assert.equal(extractProposal(envelope('{"intentType":"   ","parameters":{}}')), null);
});

test("`parameters` present but not an object proposes nothing", () => {
  assert.equal(extractProposal(envelope('{"intentType":"x","parameters":"y"}')), null);
  assert.equal(extractProposal(envelope('{"intentType":"x","parameters":[1]}')), null);
});

test("`parameters` omitted is read as no parameters — the zero-parameter READ shape", () => {
  const result = extractProposal(envelope('{"intentType":"admin.get_platform_snapshot"}'));
  assert.ok(result);
  assert.deepEqual(result.proposal.parameters, {});
});

// ─── What it does carry ──────────────────────────────────────────────────────

test("a well-formed envelope yields the intent type and parameters verbatim", () => {
  const result = extractProposal(
    envelope('{"intentType":"dealer.submit_offer","parameters":{"otdPriceCents":3150000}}'),
  );
  assert.ok(result);
  assert.equal(result.proposal.intentType, "dealer.submit_offer");
  assert.deepEqual(result.proposal.parameters, { otdPriceCents: 3150000 });
});

test("an unknown intentType is carried through — the CATALOG rejects it, not the parser", () => {
  // The parser must not second-guess catalog membership: doing so would create a
  // second authorization surface weaker than authorize.ts's six gates.
  const result = extractProposal(envelope('{"intentType":"buyer.totally_made_up","parameters":{}}'));
  assert.ok(result);
  assert.equal(result.proposal.intentType, "buyer.totally_made_up");
});

test("rationale is carried but capped", () => {
  const long = "x".repeat(MAX_RATIONALE_LENGTH + 250);
  const result = extractProposal(
    envelope(JSON.stringify({ intentType: "x", parameters: {}, rationale: long })),
  );
  assert.ok(result);
  assert.equal(result.proposal.rationale?.length, MAX_RATIONALE_LENGTH);
});

test("a blank or non-string rationale is omitted rather than stored empty", () => {
  const blank = extractProposal(envelope('{"intentType":"x","parameters":{},"rationale":"   "}'));
  assert.ok(blank);
  assert.equal(blank.proposal.rationale, undefined);

  const wrongType = extractProposal(envelope('{"intentType":"x","parameters":{},"rationale":7}'));
  assert.ok(wrongType);
  assert.equal(wrongType.proposal.rationale, undefined);
});

// ─── visibleText ─────────────────────────────────────────────────────────────

test("visibleText strips the envelope so a user never sees the machine payload", () => {
  const result = extractProposal(
    `I can submit that offer for you.\n\n${envelope('{"intentType":"dealer.submit_offer","parameters":{}}')}\n\nNothing has happened yet.`,
  );
  assert.ok(result);
  assert.ok(!result.visibleText.includes(INTENT_ENVELOPE_OPEN));
  assert.ok(!result.visibleText.includes(INTENT_ENVELOPE_CLOSE));
  assert.ok(!result.visibleText.includes("intentType"));
  assert.equal(
    result.visibleText,
    "I can submit that offer for you.\n\nNothing has happened yet.",
  );
});

test("an envelope-only reply leaves empty visibleText for the caller to replace", () => {
  const result = extractProposal(envelope('{"intentType":"x","parameters":{}}'));
  assert.ok(result);
  assert.equal(result.visibleText, "");
});
