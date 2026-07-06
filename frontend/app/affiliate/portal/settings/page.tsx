// /affiliate/portal/settings — Notification Preferences
"use client";

import { useState, useEffect } from "react";
import { Settings, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Prefs {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  auctionUpdates: boolean;
  commissionUpdates: boolean;
  marketingEmails: boolean;
}

export default function AffiliateSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>({
    emailEnabled: true,
    inAppEnabled: true,
    auctionUpdates: true,
    commissionUpdates: true,
    marketingEmails: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/affiliate/settings")
      .then(r => r.json())
      .then((json: { success?: boolean; data?: Prefs }) => {
        if (json.success && json.data) setPrefs(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/affiliate/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const json = await res.json() as { success?: boolean; data?: Prefs };
      if (json.success && json.data) { setPrefs(json.data); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    } catch { /* ignore */ }
    setSaving(false);
  }

  function toggle(key: keyof Prefs) {
    setPrefs(p => ({ ...p, [key]: !p[key] }));
    setSaved(false);
  }

  const PREF_ROWS: { key: keyof Prefs; label: string; desc: string }[] = [
    { key: "emailEnabled",      label: "Email Notifications",      desc: "Receive notifications via email" },
    { key: "inAppEnabled",      label: "In-App Notifications",     desc: "Show in-app notification badge" },
    { key: "auctionUpdates",    label: "Auction & Deal Updates",   desc: "Notify when referred buyers move through stages" },
    { key: "commissionUpdates", label: "Commission Alerts",        desc: "Alert when a commission is credited or paid" },
    { key: "marketingEmails",   label: "Marketing & Tips",         desc: "Occasional tips on growing your affiliate income" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="affiliate-settings-page">
      <div className="flex items-center gap-3 mb-6">
        <Settings size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Notification Preferences</h1>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>
      ) : (
        <>
          <div className="space-y-3 mb-6" data-testid="notification-prefs-form">
            {PREF_ROWS.map(row => (
              <div key={row.key}
                data-testid={`pref-row-${row.key}`}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{row.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{row.desc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs[row.key]}
                  onClick={() => toggle(row.key)}
                  data-testid={`pref-toggle-${row.key}`}
                  className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 ${prefs[row.key] ? "bg-al-primary" : "bg-slate-200"}`}
                  style={{ width: 40, height: 22 }}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${prefs[row.key] ? "translate-x-[18px]" : "translate-x-0"}`}
                    style={{ width: 18, height: 18 }}
                  />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              data-testid="save-prefs-btn"
              className="w-full"
            >
              {saving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</> : "Save Preferences"}
            </Button>
            {saved && (
              <div className="flex items-center gap-1.5 text-green-700 text-sm whitespace-nowrap" data-testid="prefs-saved-indicator">
                <CheckCircle2 size={16} />Saved
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
