// Unit tests for the server-side HTML sanitizer (WO-6 sanitization layer).
// Run with:  npx tsx --test lib/content/__tests__/sanitize.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeBody, bodyNeededSanitizing } from "../sanitize";

test("strips <script> tags entirely, leaving no executable markup", () => {
  const out = sanitizeBody('<p>Hello</p><script>alert("xss")</script>');
  assert.ok(!/<script/i.test(out), "script tag must be removed");
  assert.ok(out.includes("<p>Hello</p>"), "allowed content is preserved");
});

test("removes inline event handlers from allowed tags", () => {
  const out = sanitizeBody('<a href="/x" onclick="steal()">link</a>');
  assert.ok(!/onclick/i.test(out), "onclick handler must be stripped");
  assert.ok(out.includes("link"), "link text preserved");
});

test("neutralizes javascript: URLs", () => {
  const out = sanitizeBody('<a href="javascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out), "javascript: scheme must be stripped");
});

test("drops disallowed media tags (img with onerror)", () => {
  const out = sanitizeBody('<p>ok</p><img src=x onerror="alert(1)">');
  assert.ok(!/<img/i.test(out), "img tag must be removed");
  assert.ok(!/onerror/i.test(out), "onerror must be removed");
});

test("keeps the full allowlist of formatting tags", () => {
  const html =
    "<h2>T</h2><h3>S</h3><p>p <strong>b</strong> <em>i</em></p><ul><li>x</li></ul><ol><li>y</li></ol><a href=\"/z\">l</a><br>";
  const out = sanitizeBody(html);
  for (const tag of ["h2", "h3", "p", "strong", "em", "ul", "li", "ol", "a"]) {
    assert.ok(new RegExp(`<${tag}`, "i").test(out), `${tag} should survive`);
  }
});

test("bodyNeededSanitizing flags dirty bodies and passes clean ones", () => {
  assert.equal(bodyNeededSanitizing("<p>clean</p>"), false);
  assert.equal(bodyNeededSanitizing('<p>x</p><script>1</script>'), true);
});

test("handles empty / nullish input safely", () => {
  assert.equal(sanitizeBody(""), "");
  assert.equal(sanitizeBody(undefined as unknown as string), "");
});
