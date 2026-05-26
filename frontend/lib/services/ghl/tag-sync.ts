// lib/services/ghl/tag-sync.ts
// Fire-and-forget contact tagging into GoHighLevel.
//
// Posts { email, tags } to the GHL inbound webhook so platform lifecycle
// events can drive CRM automations. No-ops when GHL_WEBHOOK_URL is unset or no
// email is available, and never throws — CRM sync must never block or fail a
// platform flow.
export function syncGhlTag(email: string | null | undefined, tag: string): void {
  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (!webhookUrl || !email) return;
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, tags: [tag] }),
  }).catch(() => {});
}
