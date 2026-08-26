import 'server-only';

// Shared server-side request attribution — the single place we derive the
// client IP and user-agent for signature/consent evidence. Previously this
// x-forwarded-for / x-real-ip / user-agent logic was duplicated inline in the
// dealer agreement sign route and the dealer onboarding route; the in-house
// buyer signing flow reuses it so every signature evidence record is captured
// the same way. Always resolved server-side from request headers — never from
// the request body (a client must not be able to spoof its own attribution).

export interface RequestAttribution {
  ipAddress: string;
  userAgent: string;
}

export function getRequestAttribution(request: {
  headers: { get(name: string): string | null };
}): RequestAttribution {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return { ipAddress, userAgent };
}
