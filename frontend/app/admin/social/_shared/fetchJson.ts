// Shared JSON fetch helper for the /admin/social dashboard.
// Extracted from SocialDashboardClient.tsx (used by every tab). Reads the raw
// body first so an empty or non-JSON response (e.g. a crashed route returning a
// blank 500) surfaces a real error instead of "Unexpected end of JSON input".

import { logger } from "@/lib/logger";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });

  const text = await res.text();
  if (!text) {
    logger.error(`[fetchJson] empty response body from ${url} (${res.status})`);
    throw new Error(`Server returned an empty response (${res.status})`);
  }

  let json: { success?: boolean; data?: T; error?: { message?: string } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    logger.error(`[fetchJson] invalid JSON from ${url}:`, text.slice(0, 200));
    throw new Error(`Server returned an invalid response (${res.status})`);
  }

  if (!res.ok || json.success === false) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}
