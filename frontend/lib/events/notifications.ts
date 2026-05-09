// Lightweight pub/sub for notification count updates across components.
// Uses native browser CustomEvent — no shared state library required.
export const NOTIFICATION_CLEARED_EVENT = "autolenis:notifications-cleared";

export function emitNotificationsCleared(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_CLEARED_EVENT));
  }
}
