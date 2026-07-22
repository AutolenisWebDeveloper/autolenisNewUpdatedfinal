// Pure formatting helpers for the /admin/social dashboard.
// Extracted from SocialDashboardClient.tsx so every tab shares one
// implementation. No React/JSX — safe to import anywhere.

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}
