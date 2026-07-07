"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";

type TaxClass = "INDIVIDUAL" | "LLC" | "CORP" | "PARTNERSHIP";
type TinType = "SSN" | "EIN";

interface Props {
  initialLegalName?: string;
  initialTaxClassification?: string | null;
  initialTinType?: string | null;
  initialTinLast4?: string | null;
  certified?: boolean;
}

export default function AffiliateTaxInfoForm({
  initialLegalName = "",
  initialTaxClassification,
  initialTinType,
  initialTinLast4,
  certified: initialCertified = false,
}: Props) {
  const [legalName, setLegalName] = useState(initialLegalName);
  const [taxClass, setTaxClass] = useState<TaxClass>((initialTaxClassification as TaxClass) ?? "INDIVIDUAL");
  const [tinType, setTinType] = useState<TinType>((initialTinType as TinType) ?? "SSN");
  const [taxId, setTaxId] = useState("");
  const [certified, setCertified] = useState(initialCertified);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleSave() {
    if (!taxId) { setError("Please enter your Tax ID."); return; }
    if (!certified) { setError("You must certify under penalty of perjury."); return; }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/affiliate/finance/tax-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: legalName.trim(),
          taxClassification: taxClass,
          tinType,
          taxId,
          certified: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "Save failed."); return; }
      setSuccess(true);
      setTaxId("");
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="legal-name">Legal Name</Label>
        <Input
          id="legal-name"
          className="mt-1.5"
          value={legalName}
          onChange={e => { setLegalName(e.target.value); setSuccess(false); setError(null); }}
          placeholder="Full legal name as it appears on your tax documents"
        />
      </div>

      <div>
        <Label htmlFor="tax-classification">Tax Classification</Label>
        <select
          id="tax-classification"
          value={taxClass}
          onChange={e => { setTaxClass(e.target.value as TaxClass); setSuccess(false); setError(null); }}
          className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-al-primary/30"
        >
          <option value="INDIVIDUAL">Individual / Sole Proprietor</option>
          <option value="LLC">LLC</option>
          <option value="CORP">Corporation</option>
          <option value="PARTNERSHIP">Partnership</option>
        </select>
      </div>

      <div>
        <Label htmlFor="tin-type">TIN Type</Label>
        <select
          id="tin-type"
          value={tinType}
          onChange={e => { setTinType(e.target.value as TinType); setSuccess(false); setError(null); }}
          className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-al-primary/30"
        >
          <option value="SSN">SSN (Social Security Number)</option>
          <option value="EIN">EIN (Employer Identification Number)</option>
        </select>
      </div>

      <div>
        <Label htmlFor="tax-id">
          {tinType === "SSN" ? "SSN (XXX-XX-XXXX)" : "EIN (XX-XXXXXXX)"}
        </Label>
        <Input
          id="tax-id"
          className="mt-1.5 font-mono"
          value={taxId}
          onChange={e => setTaxId(e.target.value)}
          placeholder={initialTinLast4 ? `****${initialTinLast4} (enter new to update)` : tinType === "SSN" ? "XXX-XX-XXXX" : "XX-XXXXXXX"}
          type="password"
          autoComplete="off"
          maxLength={12}
        />
        {initialTinLast4 && !taxId && (
          <p className="text-xs text-slate-400 mt-0.5">Saved: ****{initialTinLast4}</p>
        )}
        <p className="text-xs text-slate-400 mt-1">Only the last 4 digits are stored. Your full ID is never retained.</p>
      </div>

      <label className="flex items-start gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={certified}
          onChange={e => { setCertified(e.target.checked); setError(null); }}
          className="mt-0.5 shrink-0"
          data-testid="tax-certify-checkbox"
          required
        />
        <span className="text-xs text-[#4B5563] leading-relaxed">
          Under penalties of perjury, I certify that the taxpayer identification
          number I have provided is correct and I am not subject to backup withholding.
        </span>
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-green-600">Tax information saved successfully.</p>}

      <Button onClick={handleSave} disabled={saving || !certified} className="w-full">
        {saving ? "Saving…" : "Save Tax Information"}
      </Button>
    </div>
  );
}
