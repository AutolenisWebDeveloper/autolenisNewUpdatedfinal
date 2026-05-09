export function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").replace(/\/$/, "");
}

export function getSafeBuyerRedirect(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (!value.startsWith("/buyer/")) return null;
  return value;
}

export function getSafeAffiliateRedirect(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (!value.startsWith("/affiliate/")) return null;
  return value;
}

export function getSafeDealerRedirect(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (!value.startsWith("/dealer/")) return null;
  return value;
}

// Generic safe redirect — allows /buyer/, /affiliate/, /dealer/ paths
export function getSafePortalRedirect(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  const allowed = ["/buyer/", "/affiliate/", "/dealer/"];
  if (!allowed.some(prefix => value.startsWith(prefix))) return null;
  return value;
}
