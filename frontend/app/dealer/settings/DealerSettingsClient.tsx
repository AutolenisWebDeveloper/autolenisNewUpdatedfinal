"use client";

import { useState } from "react";

interface Props {
  initialNotifyNewAuction?: boolean;
  initialNotifyOfferAccepted?: boolean;
  initialNotifyPickupReady?: boolean;
}

export default function DealerSettingsClient({
  initialNotifyNewAuction = true,
  initialNotifyOfferAccepted = true,
  initialNotifyPickupReady = true,
}: Props) {
  const [notifyNewAuction, setNotifyNewAuction] = useState(initialNotifyNewAuction);
  const [notifyOfferAccepted, setNotifyOfferAccepted] = useState(initialNotifyOfferAccepted);
  const [notifyPickupReady, setNotifyPickupReady] = useState(initialNotifyPickupReady);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/dealer/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyNewAuction, notifyOfferAccepted, notifyPickupReady }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        setError(data.error?.message ?? "Failed to save settings.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5" data-testid="dealer-settings-form">
      <h2 className="font-semibold text-slate-900">Notification Preferences</h2>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-slate-700">New auction invitations</span>
        <input
          type="checkbox"
          checked={notifyNewAuction}
          onChange={(e) => setNotifyNewAuction(e.target.checked)}
          className="accent-al-primary w-4 h-4"
          data-testid="toggle-notify-new-auction"
        />
      </label>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-slate-700">Offer accepted by buyer</span>
        <input
          type="checkbox"
          checked={notifyOfferAccepted}
          onChange={(e) => setNotifyOfferAccepted(e.target.checked)}
          className="accent-al-primary w-4 h-4"
          data-testid="toggle-notify-offer-accepted"
        />
      </label>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-slate-700">Pickup ready notification</span>
        <input
          type="checkbox"
          checked={notifyPickupReady}
          onChange={(e) => setNotifyPickupReady(e.target.checked)}
          className="accent-al-primary w-4 h-4"
          data-testid="toggle-notify-pickup-ready"
        />
      </label>

      {error && (
        <p className="text-sm text-red-600" data-testid="settings-error">{error}</p>
      )}
      {saved && (
        <p className="text-sm text-green-600" data-testid="settings-saved">Settings saved.</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
        data-testid="save-settings-btn"
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
