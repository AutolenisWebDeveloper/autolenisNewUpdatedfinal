"use client";

// Dealer notification preferences.
//
// These toggles previously POSTed to /api/dealer/settings, which returned
// { updated: true } WITHOUT persisting anything (the schema has no columns for
// them and no send-path consumes them) — so the UI reported "Settings saved"
// while nothing was saved. Rather than ship a control that lies about saving (or
// a preference that persists but is silently ignored by the notification system),
// the toggles are shown as a disabled preview with an honest "coming soon"
// status until the preference is actually wired end-to-end.

const PREFS = [
  { label: "New auction invitations", testId: "toggle-notify-new-auction" },
  { label: "Offer accepted by buyer", testId: "toggle-notify-offer-accepted" },
  { label: "Pickup ready notification", testId: "toggle-notify-pickup-ready" },
];

export default function DealerSettingsClient() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5" data-testid="dealer-settings-form">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Notification Preferences</h2>
        <span
          className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500"
          data-testid="settings-coming-soon"
        >
          Coming soon
        </span>
      </div>

      <p className="text-sm text-slate-500">
        Per-notification controls aren&apos;t available yet. For now, all dealers receive new
        auction invitations, offer-accepted, and pickup-ready notifications. You&apos;ll be able to
        fine-tune these here soon.
      </p>

      <div className="space-y-4 opacity-60">
        {PREFS.map((p) => (
          <div key={p.testId} className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{p.label}</span>
            <input
              type="checkbox"
              checked
              disabled
              aria-disabled="true"
              className="accent-al-primary w-4 h-4 cursor-not-allowed"
              data-testid={p.testId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
