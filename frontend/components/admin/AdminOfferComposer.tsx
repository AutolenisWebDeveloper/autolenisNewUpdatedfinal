"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

export default function AdminOfferComposer({
  requestId,
  defaultMake,
  defaultModel,
  defaultPriceCents,
  disabled,
}: {
  requestId: string;
  defaultMake: string;
  defaultModel: string;
  defaultPriceCents: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [make, setMake] = useState(defaultMake);
  const [model, setModel] = useState(defaultModel);
  const [trim, setTrim] = useState("");
  const [price, setPrice] = useState<string>(String(Math.round(defaultPriceCents / 100)));
  const [vehicleUrl, setVehicleUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const priceCents = Math.round(Number(price) * 100);
    if (!year || !make || !model || !priceCents) {
      setError("Year, make, model and price are required");
      return;
    }
    startTransition(async () => {
      try {
        await api.post(`/api/admin/requests/${requestId}/offer`, {
          vehicleInfo: {
            year: Number(year),
            make,
            model,
            trim: trim || undefined,
            vehicleUrl: vehicleUrl || undefined,
            otdPriceCents: priceCents,
            monthlyEstimateCents: Math.round(priceCents / 60),
          },
          priceCents,
          notes: notes || undefined,
        });
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(apiErrorMessage(err, "Unable to create offer"));
      }
    });
  }

  if (!open) {
    return (
      <Button
        size="sm"
        data-testid="create-offer-btn"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Create &amp; Send Offer
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3" data-testid="offer-composer">
      <div className="grid grid-cols-3 gap-2">
        <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Year" data-testid="offer-year-input"
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
        <input value={make} onChange={(e) => setMake(e.target.value)}
          placeholder="Make" data-testid="offer-make-input"
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
        <input value={model} onChange={(e) => setModel(e.target.value)}
          placeholder="Model" data-testid="offer-model-input"
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={trim} onChange={(e) => setTrim(e.target.value)}
          placeholder="Trim (optional)" data-testid="offer-trim-input"
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          placeholder="OTD price ($)" data-testid="offer-price-input"
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
      </div>
      <input
        value={vehicleUrl}
        onChange={(e) => setVehicleUrl(e.target.value)}
        placeholder="Vehicle listing URL (optional — helps buyer verify the vehicle)"
        type="url"
        data-testid="offer-vehicle-url-input"
        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
      />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Buyer-facing notes (optional)" data-testid="offer-notes-input"
        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" rows={2} />
      {error && <p className="text-xs text-red-600" data-testid="offer-composer-error">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending} data-testid="offer-composer-submit">
          {pending ? <><Loader2 size={12} className="animate-spin" /> Sending…</> : "Send Offer"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
