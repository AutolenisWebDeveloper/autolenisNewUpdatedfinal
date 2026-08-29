// The dealer invitation email's expiry line.
//
// THE DEFECT
// ----------
// The template hardcoded "This invitation link expires in 72 hours (by
// ${expiresAt})" while both callers pass an expiresAt computed from
// INVITATION_TOKEN_TTL_MS, which is 7 days. So the one message the dealer
// actually reads contradicted itself: a false duration sitting next to the real
// instant. And that real instant was interpolated as a raw ISO string —
// "2026-09-04T18:22:11.123Z" — which is a machine timestamp, not a deadline a
// person can act on.
//
// Both halves matter because this window is the whole reason the TTL moved: the
// previous 72h expired 6 of 11 production invitations before they were ever
// opened. Telling a dealer they have 3 days when they have 7 recreates the
// urgency failure the TTL change was meant to remove.
//
// THE RULE
// --------
// The email states the expiry the caller actually passed, rendered so a human
// can read it, with an explicit timezone. No duration literal — a hardcoded
// duration is exactly what drifted.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/email/__tests__/dealer-invitation-template.test.ts"

import test from "node:test";
import assert from "node:assert/strict";
import { renderDealerInvitationEmail } from "@/lib/services/email/templates/dealer-invitation";

const EXPIRES = new Date("2026-09-04T18:22:11.123Z");

function render(expiresAt: string): string {
  return renderDealerInvitationEmail({
    contactName: "Sam Dealer",
    dealershipName: "Example Motors",
    claimUrl: "https://autolenis.com/dealer/invite/claim?token=abc",
    expiresAt,
  });
}

test("the email no longer claims a 72-hour window", () => {
  const html = render(EXPIRES.toISOString());
  assert.doesNotMatch(
    html,
    /72\s*hours?/i,
    "the TTL is 7 days; a 72h claim understates the window by more than half",
  );
});

test("the stated expiry is the instant the caller passed", () => {
  const html = render(EXPIRES.toISOString());
  // Rendered for a person: month name, day, year, clock time, and a timezone.
  assert.match(html, /September\s+4,\s+2026/, "the expiry date must be human-readable");
  assert.match(html, /\bUTC\b/, "a bare clock time without a zone is ambiguous to a dealer");
  assert.doesNotMatch(
    html,
    /2026-09-04T18:22:11/,
    "a raw ISO timestamp is not a deadline a recipient can act on",
  );
});

test("an expiry that cannot be parsed is shown verbatim, never as 'Invalid Date'", () => {
  const html = render("sometime next week");
  assert.doesNotMatch(html, /Invalid Date/, "a formatting failure must not become dealer-facing text");
  assert.match(html, /sometime next week/, "fall back to what the caller supplied");
});

test("the claim link still renders intact", () => {
  const html = render(EXPIRES.toISOString());
  assert.match(html, /href="https:\/\/autolenis\.com\/dealer\/invite\/claim\?token=abc"/);
});
