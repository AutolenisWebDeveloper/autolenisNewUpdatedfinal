// D12 — SSRF. A dealer-supplied documentUrl must never reach an internal address.
import test from "node:test";
import assert from "node:assert/strict";
import { assertAllowedContractUrl, BlockedUrlError } from "@/lib/security/safe-fetch";

const ORIGINAL = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";

test("the configured storage host over https is allowed", () => {
  const u = assertAllowedContractUrl("https://abcdefgh.supabase.co/storage/v1/object/c.pdf");
  assert.equal(u.hostname, "abcdefgh.supabase.co");
});

for (const bad of [
  "http://abcdefgh.supabase.co/c.pdf",          // plaintext downgrade
  "https://169.254.169.254/latest/meta-data/",  // cloud metadata
  "https://127.0.0.1/c.pdf",
  "https://localhost/c.pdf",
  "https://10.0.0.5/c.pdf",
  "https://192.168.1.1/c.pdf",
  "https://172.16.0.1/c.pdf",
  "https://[::1]/c.pdf",
  "https://evil.example.com/c.pdf",             // host not on the allowlist
  "https://abcdefgh.supabase.co.evil.com/c.pdf",// suffix-confusion
  "file:///etc/passwd",
  "gopher://evil/x",
  "not a url",
]) {
  test(`blocked: ${bad}`, () => {
    assert.throws(() => assertAllowedContractUrl(bad), BlockedUrlError);
  });
}

test("fails CLOSED when no storage host is configured", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_URL = "";
  assert.throws(() => assertAllowedContractUrl("https://anything.example.com/c.pdf"), BlockedUrlError);
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL ?? "https://abcdefgh.supabase.co";
});
