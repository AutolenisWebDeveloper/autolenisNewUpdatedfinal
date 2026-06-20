"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Download, FileText, ChevronDown, FileSpreadsheet } from "lucide-react";

const REPORTS: Array<{ kind: string; label: string }> = [
  { kind: "opportunities", label: "Market Opportunities" },
  { kind: "vehicles", label: "Vehicle Segments" },
  { kind: "content", label: "Content Performance" },
];

export default function AmipsExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/admin/amips/report"
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#475569] hover:border-[#BFDBFE] hover:text-[#0B5FD1] transition-all shadow-sm"
      >
        <FileText size={12} /> Report
      </Link>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#475569] hover:border-[#BFDBFE] hover:text-[#0B5FD1] transition-all shadow-sm"
        >
          <Download size={12} /> Export <ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {open && (
          <div className="absolute right-0 mt-1.5 w-56 rounded-xl border border-[#E2E8F0] bg-white shadow-lg z-20 overflow-hidden">
            <p className="px-3 py-2 text-[10px] font-bold text-[#94A3B8] uppercase tracking-wide border-b border-[#F1F5F9]">
              Download CSV
            </p>
            {REPORTS.map((r) => (
              <a
                key={r.kind}
                href={`/api/admin/amips/export?report=${r.kind}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-xs text-[#475569] hover:bg-[#F8FAFF] hover:text-[#0B5FD1] transition-colors"
              >
                <FileSpreadsheet size={13} className="text-[#94A3B8]" />
                {r.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
