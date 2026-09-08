// §5 rule 2 — attribution normalisation, at the unit level.
//
// The rule reads "a submission with no attribution is recorded as `direct`, never
// as null", and the whole defect §7.2 found is a misreading of it: three Vehicle
// Requests with utm_source, landing_source and ip_address all NULL and no channel
// recorded at all. The SUBMISSION is recorded as direct; the FIELDS are not, and
// the Phase 1 CHECK constraints refuse a sentinel in an address column either way.
//
// Run: pnpm test:intake

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAttribution,
  normalizeUrl,
  deriveAcquisitionChannel,
  captureClientIp,
  DIRECT_CHANNEL,
  IP_UNAVAILABLE_REASONS,
} from "../intake-attribution";

test("no attribution at all → channel `direct`, every field NULL", () => {
  const a = normalizeAttribution({});
  assert.equal(a.acquisitionChannel, DIRECT_CHANNEL);
  assert.equal(a.utmSource, null);
  assert.equal(a.utmMedium, null);
  assert.equal(a.utmCampaign, null);
  assert.equal(a.utmContent, null);
  assert.equal(a.sourceUrl, null);
  assert.equal(a.referrer, null);
  assert.equal(a.landingSource, null);
  assert.equal(a.affiliateId, null);
});

test("the sentinel never reaches a column that is not the channel", () => {
  const a = normalizeAttribution({});
  for (const [k, v] of Object.entries(a)) {
    if (k === "acquisitionChannel") continue;
    assert.notEqual(v, "direct", `${k} must never hold the sentinel — the Phase 1 CHECKs refuse it`);
    assert.notEqual(v, "unknown", `${k} must never hold a sentinel`);
  }
});

test("channel precedence: affiliate beats utm beats landing beats referral", () => {
  assert.equal(deriveAcquisitionChannel({ affiliateId: "aff_1", utmSource: "google" }), "affiliate");
  assert.equal(deriveAcquisitionChannel({ utmSource: "Google", landingSource: "seo_frisco" }), "google");
  assert.equal(deriveAcquisitionChannel({ landingSource: "SEO_Frisco" }), "seo_frisco");
  assert.equal(deriveAcquisitionChannel({ referrer: "https://news.example.com/a" }), "referral");
});

test("a referrer from our own host is navigation, not an acquisition", () => {
  assert.equal(
    deriveAcquisitionChannel({ referrer: "https://autolenis.com/how-it-works" }, "autolenis.com"),
    DIRECT_CHANNEL
  );
});

test("a URL column holds a valid absolute http(s) URL or NULL", () => {
  assert.equal(normalizeUrl("https://a.example/x?y=1"), "https://a.example/x?y=1");
  assert.equal(normalizeUrl("http://a.example"), "http://a.example/");
  assert.equal(normalizeUrl("android-app://com.example"), null, "a non-http scheme is not a URL for this column");
  assert.equal(normalizeUrl("not a url"), null);
  assert.equal(normalizeUrl("   "), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null, "a script scheme must never be stored");
});

test("an address OR a reason, never both, never a sentinel", () => {
  const withIp = normalizeAttribution({ ipAddress: "203.0.113.7" });
  assert.equal(withIp.ipAddress, "203.0.113.7");
  assert.equal(withIp.ipUnavailableReason, null, "the Phase 1 CHECK makes these mutually exclusive");

  const without = normalizeAttribution({ ipUnavailableReason: "PROXY_HEADER_ABSENT" });
  assert.equal(without.ipAddress, null);
  assert.equal(without.ipUnavailableReason, "PROXY_HEADER_ABSENT");

  // Both supplied: the address wins, because it is the stronger fact and the
  // database would reject the pair.
  const both = normalizeAttribution({ ipAddress: "203.0.113.7", ipUnavailableReason: "UNKNOWN" });
  assert.equal(both.ipUnavailableReason, null);
});

test("a missing reason defaults to UNKNOWN, which is in the migration's vocabulary", () => {
  const a = normalizeAttribution({});
  assert.equal(a.ipUnavailableReason, "UNKNOWN");
  assert.ok(IP_UNAVAILABLE_REASONS.includes(a.ipUnavailableReason!));
});

test("the IP is captured from forwarding headers, or a reason is recorded", () => {
  const withHeader = captureClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 70.0.0.1" }));
  assert.equal(withHeader.ipAddress, "203.0.113.7", "the leftmost entry is what the platform observed");
  assert.equal(withHeader.ipUnavailableReason, null);

  const none = captureClientIp(new Headers());
  assert.equal(none.ipAddress, null);
  assert.equal(none.ipUnavailableReason, "PROXY_HEADER_ABSENT");
});

test("whitespace-only values are absent, not empty strings", () => {
  const a = normalizeAttribution({ utmSource: "   ", utmCampaign: "" });
  assert.equal(a.utmSource, null);
  assert.equal(a.utmCampaign, null);
  assert.equal(a.acquisitionChannel, DIRECT_CHANNEL);
});
