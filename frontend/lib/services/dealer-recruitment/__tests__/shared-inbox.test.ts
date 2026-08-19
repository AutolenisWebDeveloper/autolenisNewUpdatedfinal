// Block B / B2a — shared-inbox collapse (SSoT). Pure module; no mocks needed.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/shared-inbox.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isSharedInbox, collapseByInbox } from "../shared-inbox";

// ─── isSharedInbox ───────────────────────────────────────────────────────────

test("flags role/generic local-parts as shared inboxes (case- and separator-insensitive)", () => {
  assert.equal(isSharedInbox("internetsales@dealer.com"), true);
  assert.equal(isSharedInbox("Sales@Dealer.com"), true);
  assert.equal(isSharedInbox("info@dealer.com"), true);
  assert.equal(isSharedInbox("internet.sales@dealer.com"), true); // separators stripped
  assert.equal(isSharedInbox("bdc@dealer.com"), true);
});

test("does NOT flag a personal mailbox", () => {
  assert.equal(isSharedInbox("john.smith@dealer.com"), false);
  assert.equal(isSharedInbox("jdoe@dealer.com"), false);
});

test("returns false for empty/invalid input (fail safe — not a shared inbox)", () => {
  assert.equal(isSharedInbox(null), false);
  assert.equal(isSharedInbox(undefined), false);
  assert.equal(isSharedInbox(""), false);
  assert.equal(isSharedInbox("not-an-email"), false);
});

// ─── collapseByInbox ─────────────────────────────────────────────────────────

test("collapses items that reach the SAME mailbox to one (keeps first occurrence)", () => {
  const items = [
    { id: "a", email: "sales@dealer.com" },
    { id: "b", email: "SALES@dealer.com" }, // same mailbox, different case
    { id: "c", email: "john@dealer.com" },
  ];
  const out = collapseByInbox(items, (i) => i.email);
  assert.deepEqual(out.map((i) => i.id), ["a", "c"]); // b collapsed into a
});

test("passes through items with no usable email (can't collapse what has no address)", () => {
  const items = [
    { id: "a", email: null },
    { id: "b", email: undefined },
    { id: "c", email: "x@dealer.com" },
  ];
  const out = collapseByInbox(items, (i) => i.email as string | null);
  assert.deepEqual(out.map((i) => i.id), ["a", "b", "c"]);
});
