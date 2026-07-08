"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface ExpandableSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}

export default function ExpandableSection({
  title,
  icon,
  children,
  defaultOpen = false,
  testId,
}: ExpandableSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
      data-testid={testId}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-al-primary/40"
        aria-expanded={open}
        aria-controls={testId ? `${testId}-content` : undefined}
      >
        <div className="flex items-center gap-2.5">
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="text-sm font-semibold text-slate-900">{title}</span>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={testId ? `${testId}-content` : undefined}
        className={`grid transition-all duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5 border-t border-slate-100">
            <div className="pt-4">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
