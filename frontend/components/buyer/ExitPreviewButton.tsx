"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

// Clears the admin preview token (set with path=/buyer) and leaves the
// impersonated view. If the preview was opened in its own tab we close it;
// otherwise we fall back to the admin support console.
export default function ExitPreviewButton() {
  const [leaving, setLeaving] = useState(false);

  function onExit() {
    setLeaving(true);
    document.cookie = "admin_preview_token=; path=/buyer; max-age=0; SameSite=Strict";
    window.close();
    // window.close() is a no-op for tabs the script did not open — redirect out.
    window.location.href = "/admin/support";
  }

  return (
    <button
      type="button"
      onClick={onExit}
      disabled={leaving}
      data-testid="exit-preview-btn"
      className="inline-flex items-center gap-1.5 rounded-md bg-white/20 hover:bg-white/30 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-60"
    >
      <LogOut size={12} />
      {leaving ? "Exiting…" : "Exit preview"}
    </button>
  );
}
