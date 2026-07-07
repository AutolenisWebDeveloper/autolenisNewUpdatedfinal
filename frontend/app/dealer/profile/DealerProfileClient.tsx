"use client";

import { useState } from "react";
import { api, apiErrorMessage } from "@/lib/api/client";

interface Props {
  dealershipName: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  address?: string | null;
}

export default function DealerProfileClient(props: Props) {
  const [dealershipName, setDealershipName] = useState(props.dealershipName);
  const [phone, setPhone] = useState(props.phone ?? "");
  const [address, setAddress] = useState(props.address ?? "");
  const [city, setCity] = useState(props.city ?? "");
  const [stateVal, setStateVal] = useState(props.state ?? "");
  const [zip, setZip] = useState(props.zip ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch("/api/dealer/profile", {
        dealershipName: dealershipName.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        state: stateVal.trim() || undefined,
        zip: zip.trim() || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Network error. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSave}
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      data-testid="dealer-profile-form"
    >
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Dealership name</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
          value={dealershipName}
          onChange={(e) => setDealershipName(e.target.value)}
          data-testid="profile-name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-500 bg-slate-50"
          value={props.email}
          readOnly
          data-testid="profile-email"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +1 555 000 1234"
          data-testid="profile-phone"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Address</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street address"
          data-testid="profile-address"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">City</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            data-testid="profile-city"
          />
        </div>
        <div className="col-span-1">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">State</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value)}
            data-testid="profile-state"
          />
        </div>
        <div className="col-span-1">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">ZIP</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            data-testid="profile-zip"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600" data-testid="profile-error">{error}</p>
      )}
      {saved && (
        <p className="text-sm text-green-600" data-testid="profile-saved">Profile updated.</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
        data-testid="save-profile-btn"
      >
        {saving ? "Saving..." : "Save Profile"}
      </button>
    </form>
  );
}
