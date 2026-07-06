"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 px-4 py-2 bg-al-primary rounded-xl text-xs font-semibold text-white hover:bg-al-primary-hover transition-colors shadow-sm print:hidden"
    >
      <Printer size={13} /> Print / Save PDF
    </button>
  );
}
