"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Check, X } from "lucide-react";

interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export default function ProfileEditor({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/buyer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          address: form.address,
          city: form.city,
          state: form.state,
          zip: form.zip,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error?.message ?? "Couldn't save. Please retry.");
        return;
      }
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      startTransition(() => router.refresh());
    } catch {
      setError("Network error. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  function onCancel() {
    setForm(initial);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6" data-testid="profile-editor">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-slate-900">Personal information</p>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-al-primary hover:bg-al-primary/5 px-3 py-1.5 rounded-md transition-colors border border-al-primary/20"
            data-testid="edit-profile-btn"
          >
            <Pencil size={12} />
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-al-primary text-white hover:bg-al-primary-hover px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              data-testid="save-profile-btn"
            >
              <Check size={12} />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-md transition-colors"
              data-testid="cancel-profile-btn"
            >
              <X size={12} />
              Cancel
            </button>
          </div>
        )}
      </div>

      {saved && (
        <div className="mb-4 bg-[#50D14E]/10 border border-[#50D14E]/30 text-[#1A6B18] text-xs px-3 py-2 rounded-md" role="status" data-testid="profile-saved-banner">
          Profile updated.
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-md" role="alert" data-testid="profile-error-banner">{error}</div>
      )}

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>First name</Label>
            <Input className="mt-1.5" data-testid="profile-firstname" value={form.firstName} readOnly={!editing} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <Label>Last name</Label>
            <Input className="mt-1.5" data-testid="profile-lastname" value={form.lastName} readOnly={!editing} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <Input className="mt-1.5" data-testid="profile-email" defaultValue={form.email} readOnly />
          <p className="text-[10px] text-slate-400 mt-1">To change your email, contact support.</p>
        </div>
        <div>
          <Label>Phone</Label>
          <Input className="mt-1.5" data-testid="profile-phone" value={form.phone} readOnly={!editing} placeholder={editing ? "(555) 123-4567" : "—"} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <Label>Address</Label>
          <Input className="mt-1.5" data-testid="profile-address" value={form.address} readOnly={!editing} placeholder={editing ? "Street address" : "—"} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Label>City</Label>
            <Input className="mt-1.5" data-testid="profile-city" value={form.city} readOnly={!editing} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label>State</Label>
            <Input className="mt-1.5" data-testid="profile-state" value={form.state} readOnly={!editing} maxLength={2} placeholder={editing ? "CA" : "—"} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
          </div>
        </div>
        <div>
          <Label>ZIP</Label>
          <Input className="mt-1.5 max-w-[140px]" data-testid="profile-zip" value={form.zip} readOnly={!editing} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
