"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api/client";

// Wires the inventory-detail Activate/Deactivate control to the existing
// audit-logged PATCH /api/admin/inventory/[id]/deactivate route (previously
// the button had no handler). "Force Resync" was removed — it had no backend.
export default function InventoryItemActions({
  itemId,
  isActive,
}: {
  itemId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const d = await api.patch<{ isActive: boolean }>(
        `/api/admin/inventory/${itemId}/deactivate`,
        { activate: !isActive },
      );
      toast.success(d.isActive ? "Vehicle activated" : "Vehicle deactivated");
      router.refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Failed to update vehicle status"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2 mt-4">
      <Button size="sm" variant="secondary" data-testid="toggle-active-btn" disabled={busy} onClick={toggle}>
        {busy && <Loader2 size={12} className="animate-spin mr-1" aria-hidden />}
        {isActive ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );
}
