// Shared HTTP helper for Social Engine provider calls.
//
// Wraps fetch with a default request timeout (via AbortSignal.timeout) so a hung
// upstream — a social platform API, an AI provider, a media download — can never
// block a serverless cron/worker until the platform's function timeout. Callers
// may still pass their own AbortSignal to override.

export const PROVIDER_TIMEOUT_MS = 20_000;

export function providerFetch(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
