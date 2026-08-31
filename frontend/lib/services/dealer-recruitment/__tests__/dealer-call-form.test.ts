// The operator-facing half of manual call logging.
//
// WHY THIS IS A SERVICE AND NOT COMPONENT CODE. Two rules live here that are
// easy to get wrong in JSX and impossible to test there: what a dialable number
// is, and how an operator's "4 minutes" becomes the integer seconds the log
// stores. This repo has no React render harness, so logic buried in a component
// is logic nothing checks. Extracted, it is eight assertions.
//
// Run: pnpm test

import test from "node:test";
import assert from "node:assert/strict";

import {
  telHref,
  buildCallLogRequest,
  DISPOSITION_LABELS,
} from "../dealer-call-form";
import { CALL_DISPOSITIONS } from "../dealer-call-log.service";

// ── tel: links ──────────────────────────────────────────────────────────────

test("telHref emits a tel: URI for a usable US number", () => {
  assert.equal(telHref("+15125550101"), "tel:+15125550101");
  // Whatever shape the row holds, the link is normalised — a href built from
  // "(512) 555-0101" is a dead link on half of the phones that will open it.
  assert.equal(telHref("(512) 555-0101"), "tel:+15125550101");
});

test("telHref returns null rather than a broken link", () => {
  // A tel: href that cannot dial is worse than no link: it looks actionable,
  // the operator taps it, and nothing happens.
  assert.equal(telHref(null), null);
  assert.equal(telHref(""), null);
  assert.equal(telHref("not a phone"), null);
  assert.equal(telHref("555-0101"), null, "seven digits cannot be dialled");
});

// ── duration ────────────────────────────────────────────────────────────────

test("minutes and seconds become integer seconds", () => {
  const req = buildCallLogRequest({
    prospectId: "p1",
    disposition: "CONNECTED",
    minutes: "4",
    seconds: "30",
    notes: "",
  });
  assert.equal(req.ok, true);
  assert.equal(req.ok && req.value.durationSeconds, 270);
});

test("an empty duration is zero, not NaN", () => {
  // The service refuses a non-finite duration, so an untouched field must not
  // become one. An operator who logs a voicemail should not have to type "0".
  const req = buildCallLogRequest({
    prospectId: "p1",
    disposition: "VOICEMAIL",
    minutes: "",
    seconds: "",
    notes: "",
  });
  assert.equal(req.ok, true);
  assert.equal(req.ok && req.value.durationSeconds, 0);
});

test("a negative or non-numeric duration is refused in the form, not at the API", () => {
  for (const bad of ["-1", "abc", "1e400"]) {
    const req = buildCallLogRequest({
      prospectId: "p1",
      disposition: "CONNECTED",
      minutes: bad,
      seconds: "",
      notes: "",
    });
    assert.equal(req.ok, false, `minutes="${bad}" must be refused`);
  }
});

// ── disposition and notes ───────────────────────────────────────────────────

test("every disposition the service accepts has an operator-facing label", () => {
  // A dropdown that offers a value the service rejects, or omits one it
  // accepts, is a silent divergence. Asserted against the service's own list.
  for (const d of CALL_DISPOSITIONS) {
    assert.ok(DISPOSITION_LABELS[d], `${d} has no label`);
  }
  assert.equal(
    Object.keys(DISPOSITION_LABELS).length,
    CALL_DISPOSITIONS.length,
    "the label map must not carry a disposition the service does not accept",
  );
});

test("an unselected disposition is refused", () => {
  const req = buildCallLogRequest({ prospectId: "p1", disposition: "", minutes: "", seconds: "", notes: "" });
  assert.equal(req.ok, false);
});

test("notes are trimmed, and whitespace-only notes become undefined", () => {
  const withNotes = buildCallLogRequest({
    prospectId: "p1", disposition: "CONNECTED", minutes: "1", seconds: "", notes: "  spoke to the GM  ",
  });
  assert.equal(withNotes.ok && withNotes.value.notes, "spoke to the GM");

  const blank = buildCallLogRequest({
    prospectId: "p1", disposition: "CONNECTED", minutes: "1", seconds: "", notes: "   ",
  });
  assert.equal(blank.ok && blank.value.notes, undefined);
});

test("a missing prospect id is refused — the form must not POST a headless call", () => {
  const req = buildCallLogRequest({ prospectId: "", disposition: "CONNECTED", minutes: "1", seconds: "", notes: "" });
  assert.equal(req.ok, false);
});
