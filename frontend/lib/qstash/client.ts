import { Client } from "@upstash/qstash";

// Lazy-init so `next build` (which imports route modules for static analysis)
// doesn't crash when QSTASH_TOKEN is absent from the build environment. The
// token is only required at runtime, when a job is actually dispatched.
let _qstash: Client | null = null;

export function getQstash(): Client {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error("QSTASH_TOKEN is not set");
  }
  if (!_qstash) {
    _qstash = new Client({ token: process.env.QSTASH_TOKEN });
  }
  return _qstash;
}

export const QSTASH_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";
