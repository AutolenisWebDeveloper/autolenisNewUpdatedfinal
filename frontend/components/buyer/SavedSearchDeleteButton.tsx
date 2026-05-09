"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

export default function SavedSearchDeleteButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this saved search?")) return;
    setBusy(true);
    try {
      await fetch(`/api/buyer/searches/${searchId}`, { method: "DELETE" });
      router.refresh();
    } catch {
      // refresh shows updated state
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="p-2 text-[#9CA3AF] hover:text-red-500 disabled:opacity-40 transition-colors"
      data-testid={`delete-search-${searchId}`}
      aria-label="Delete saved search"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
    </button>
  );
}
