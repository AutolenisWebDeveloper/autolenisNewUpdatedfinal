"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings as SettingsIcon, Bell, MessageCircle, Megaphone, Gavel, FileText, Lock, Trash2, Mail, Smartphone } from "lucide-react";
import { api, apiErrorMessage, ApiError } from "@/lib/api/client";

interface Preferences {
  emailNotifications: boolean;
  marketingEmails: boolean;
  auctionAlerts: boolean;
  dealUpdates: boolean;
  smsNotifications?: boolean; // Coming Soon — excluded from PATCH payload
}

export default function SettingsClient({ initial, email }: { initial: Preferences; email: string }) {
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function persist(next: Preferences) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // smsNotifications is Coming Soon — never include in PATCH body
      const { smsNotifications: _sms, ...payload } = next;
      await api.patch("/api/buyer/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't save. Please retry."));
      setPrefs(initial);
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof Preferences) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    persist(next);
  }

  async function onDelete() {
    setDeleting(true);
    setError(null);
    setDeleteError(null);
    try {
      await api.del("/api/buyer/account");
      // Account deleted — sign out + redirect to home
      window.location.href = "/";
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACTIVE_DEAL") {
        setDeleteError(
          "You have an active deal in progress. Complete or cancel it before deleting your account."
        );
      } else {
        setDeleteError(
          apiErrorMessage(err, "Account deletion failed. Please contact support.")
        );
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="settings-page">
      <div className="flex items-center gap-3 mb-2">
        <SettingsIcon size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Manage your notification preferences, security, and account.</p>

      {/* Save-state banner */}
      {(saved || error) && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-md text-sm ${saved ? "bg-[#50D14E]/10 border border-[#50D14E]/30 text-[#1A6B18]" : "bg-red-50 border border-red-200 text-red-700"}`}
          role="status"
          data-testid={saved ? "settings-saved-banner" : "settings-error-banner"}
        >
          {saved ? "Preferences saved." : error}
        </div>
      )}

      {/* Notification preferences */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6" data-testid="notification-preferences">
        <header className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Bell size={15} className="text-al-primary" />
            Notification Preferences
          </h2>
          <p className="text-xs text-slate-500 mt-1">Choose what we send you and how.</p>
        </header>
        <div className="divide-y divide-slate-100">
          <PrefRow
            testId="pref-email-notifications"
            icon={Mail}
            title="Email notifications"
            description="Auction updates, deal progress, receipts, and account security."
            checked={prefs.emailNotifications}
            disabled={saving}
            onToggle={() => toggle("emailNotifications")}
          />
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#F8F9FB] border border-[#E5E7EB] flex items-center justify-center shrink-0 mt-0.5">
                <Smartphone size={14} className="text-al-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#111827]">SMS Notifications</p>
                <p className="text-xs text-[#6B7280] mt-0.5">Text message alerts for key deal milestones</p>
              </div>
            </div>
            <span className="text-xs font-semibold text-[#6B7280] bg-[#F3F4F6] px-2.5 py-1 rounded-full shrink-0">
              Coming Soon
            </span>
          </div>
          <PrefRow
            testId="pref-auction-alerts"
            icon={Gavel}
            title="Auction alerts"
            description="New offers, countdown reminders, and winning-selection confirmations."
            checked={prefs.auctionAlerts}
            disabled={saving}
            onToggle={() => toggle("auctionAlerts")}
          />
          <PrefRow
            testId="pref-deal-updates"
            icon={FileText}
            title="Deal updates"
            description="Financing approvals, contract changes, e-sign requests, pickup scheduling."
            checked={prefs.dealUpdates}
            disabled={saving}
            onToggle={() => toggle("dealUpdates")}
          />
          <PrefRow
            testId="pref-marketing-emails"
            icon={Megaphone}
            title="Marketing emails"
            description="Tips, inventory highlights, and occasional promotional offers."
            checked={prefs.marketingEmails}
            disabled={saving}
            onToggle={() => toggle("marketingEmails")}
          />
        </div>
      </section>

      {/* Security */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6" data-testid="security-section">
        <header className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Lock size={15} className="text-al-primary" />
            Security
          </h2>
        </header>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900">Password</p>
              <p className="text-xs text-slate-500">Reset your password via a secure email link.</p>
            </div>
            <Link
              href="/auth/forgot-password"
              className="text-xs font-semibold text-al-primary hover:underline px-3 py-1.5 border border-al-primary/30 rounded-md hover:bg-al-primary/5 transition-colors shrink-0"
              data-testid="change-password-link"
            >
              Change password →
            </Link>
          </div>
          <div className="flex items-center justify-between gap-4 pt-3 border-t border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-900">Account email</p>
              <p className="text-xs text-slate-500">{email}</p>
            </div>
            <Link
              href="/buyer/messages"
              className="text-xs text-slate-400 hover:text-al-primary shrink-0"
              data-testid="request-email-change-link"
            >
              Contact support →
            </Link>
          </div>
        </div>
      </section>

      {/* Communication channels */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6" data-testid="support-section">
        <header className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <MessageCircle size={15} className="text-al-primary" />
            Support
          </h2>
        </header>
        <div className="p-5 space-y-3">
          <Link href="/buyer/messages" className="flex items-center justify-between hover:bg-slate-50 -mx-2 px-2 py-2 rounded-md transition-colors" data-testid="settings-messages-link">
            <span className="text-sm text-slate-700">Message the AutoLenis team</span>
            <span className="text-xs text-slate-400">→</span>
          </Link>
          <Link href="/faq" className="flex items-center justify-between hover:bg-slate-50 -mx-2 px-2 py-2 rounded-md transition-colors" data-testid="settings-faq-link">
            <span className="text-sm text-slate-700">Frequently asked questions</span>
            <span className="text-xs text-slate-400">→</span>
          </Link>
          <Link href="/legal/privacy" className="flex items-center justify-between hover:bg-slate-50 -mx-2 px-2 py-2 rounded-md transition-colors" data-testid="settings-privacy-link">
            <span className="text-sm text-slate-700">Privacy policy</span>
            <span className="text-xs text-slate-400">→</span>
          </Link>
          <Link href="/legal/terms" className="flex items-center justify-between hover:bg-slate-50 -mx-2 px-2 py-2 rounded-md transition-colors" data-testid="settings-terms-link">
            <span className="text-sm text-slate-700">Terms of Service</span>
            <span className="text-xs text-slate-400">→</span>
          </Link>
        </div>
      </section>

      {/* Danger zone */}
      <section className="bg-white border border-red-200 rounded-xl overflow-hidden" data-testid="danger-zone">
        <header className="px-5 py-4 border-b border-red-100 bg-red-50/50">
          <h2 className="text-sm font-semibold text-red-900 flex items-center gap-2">
            <Trash2 size={15} />
            Danger Zone
          </h2>
        </header>
        <div className="p-5">
          <p className="text-sm text-slate-700 mb-1 font-medium">Delete your AutoLenis account</p>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Permanently removes your account, saved searches, and profile data. Active deals, contracts, and financial records must be retained for legal and tax purposes.
          </p>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="text-xs font-semibold text-red-700 border border-red-300 rounded-md px-3 py-1.5 hover:bg-red-50 transition-colors"
            data-testid="delete-account-btn"
          >
            Delete my account
          </button>
        </div>
      </section>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          data-testid="delete-account-modal"
        >
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Delete account?</h3>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              This action is irreversible. Type <code className="bg-red-50 text-red-700 px-1 rounded">DELETE</code> to confirm.
            </p>
            <input
              type="text"
              value={confirmDeleteText}
              onChange={(e) => setConfirmDeleteText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm mb-4 focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              data-testid="delete-confirm-input"
            />
            {deleteError && (
              <p className="text-xs text-red-600 mt-2 mb-2" data-testid="delete-account-error">
                {deleteError}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setShowDeleteModal(false); setConfirmDeleteText(""); }}
                className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                data-testid="cancel-delete-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={confirmDeleteText !== "DELETE" || deleting}
                className="px-4 py-2 text-sm font-bold bg-red-600 text-white hover:bg-red-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="confirm-delete-btn"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PrefRowProps {
  testId: string;
  icon: typeof Bell;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}
function PrefRow({ testId, icon: Icon, title, description, checked, disabled, onToggle }: PrefRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#F8F9FB] border border-[#E5E7EB] flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={14} className="text-al-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-al-primary" : "bg-slate-300"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        data-testid={testId}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
