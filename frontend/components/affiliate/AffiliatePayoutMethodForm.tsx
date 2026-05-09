"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";

type Method = "CHECK" | "ACH" | "PAYPAL" | "ZELLE";

interface Props {
  initialMethod?: string;
  initialBankName?: string | null;
  initialAccountType?: string | null;
  initialRoutingLast4?: string | null;
  initialAccountLast4?: string | null;
  initialZelleEmail?: string | null;
  initialPaypalEmail?: string | null;
}

export default function AffiliatePayoutMethodForm({
  initialMethod,
  initialBankName,
  initialAccountType,
  initialRoutingLast4,
  initialAccountLast4,
  initialZelleEmail,
  initialPaypalEmail,
}: Props) {
  const [method, setMethod] = useState<Method>((initialMethod as Method) ?? "CHECK");
  const [bankName, setBankName] = useState(initialBankName ?? "");
  const [accountType, setAccountType] = useState(initialAccountType ?? "CHECKING");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [zelleEmail, setZelleEmail] = useState(initialZelleEmail ?? "");
  const [paypalEmail, setPaypalEmail] = useState(initialPaypalEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body: Record<string, string> = { method };
      if (method === "ACH") {
        if (bankName) body.bankName = bankName;
        body.accountType = accountType;
        if (routingNumber) body.routingNumber = routingNumber;
        if (accountNumber) body.accountNumber = accountNumber;
      }
      if (method === "PAYPAL") body.paypalEmail = paypalEmail;
      if (method === "ZELLE") body.zelleEmail = zelleEmail;

      const res = await fetch("/api/affiliate/finance/payout-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "Save failed."); return; }
      setSuccess(true);
      setRoutingNumber("");
      setAccountNumber("");
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
        <Label htmlFor="payout-method">Payout Method</Label>
        <select
          id="payout-method"
          value={method}
          onChange={e => { setMethod(e.target.value as Method); setSuccess(false); setError(null); }}
          className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
        >
          <option value="CHECK">Check (mailed)</option>
          <option value="ACH">ACH Bank Transfer</option>
          <option value="PAYPAL">PayPal</option>
          <option value="ZELLE">Zelle</option>
        </select>
      </div>

      {method === "ACH" && (
        <>
          <div>
            <Label htmlFor="bank-name">Bank Name</Label>
            <Input id="bank-name" className="mt-1.5" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Chase Bank" />
          </div>
          <div>
            <Label htmlFor="account-type">Account Type</Label>
            <select
              id="account-type"
              value={accountType}
              onChange={e => setAccountType(e.target.value)}
              className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
            >
              <option value="CHECKING">Checking</option>
              <option value="SAVINGS">Savings</option>
            </select>
          </div>
          <div>
            <Label htmlFor="routing-number">Routing Number</Label>
            <Input
              id="routing-number"
              className="mt-1.5 font-mono"
              value={routingNumber}
              onChange={e => setRoutingNumber(e.target.value)}
              placeholder={initialRoutingLast4 ? `****${initialRoutingLast4} (enter new to update)` : "9-digit routing number"}
              maxLength={9}
              type="password"
              autoComplete="off"
            />
            {initialRoutingLast4 && !routingNumber && (
              <p className="text-xs text-slate-400 mt-0.5">Saved: ****{initialRoutingLast4}</p>
            )}
          </div>
          <div>
            <Label htmlFor="account-number">Account Number</Label>
            <Input
              id="account-number"
              className="mt-1.5 font-mono"
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value)}
              placeholder={initialAccountLast4 ? `****${initialAccountLast4} (enter new to update)` : "Account number"}
              type="password"
              autoComplete="off"
            />
            {initialAccountLast4 && !accountNumber && (
              <p className="text-xs text-slate-400 mt-0.5">Saved: ****{initialAccountLast4}</p>
            )}
          </div>
        </>
      )}

      {method === "PAYPAL" && (
        <div>
          <Label htmlFor="paypal-email">PayPal Email</Label>
          <Input id="paypal-email" type="email" className="mt-1.5" value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} placeholder="your@paypal.com" />
        </div>
      )}

      {method === "ZELLE" && (
        <div>
          <Label htmlFor="zelle-email">Zelle Phone or Email</Label>
          <Input id="zelle-email" className="mt-1.5" value={zelleEmail} onChange={e => setZelleEmail(e.target.value)} placeholder="Phone or email registered with Zelle" />
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-green-600">Payout method saved successfully.</p>}

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Saving…" : "Save Payout Method"}
      </Button>
    </div>
  );
}
