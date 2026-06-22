"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";

export type DealerFaqItem = { q: string; a: string };

/**
 * DealerFAQ — the only interactive piece of the For Dealers page.
 * Keyboard-accessible disclosure list with aria-expanded / aria-controls.
 */
export default function DealerFAQ({ items }: { items: DealerFaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number>(0);

  return (
    <div className="border-t border-slate-200">
      {items.map((item, i) => {
        const isOpen = i === openIndex;
        const panelId = `dealer-faq-panel-${i}`;
        const buttonId = `dealer-faq-button-${i}`;
        return (
          <div key={item.q} className="border-b border-slate-200">
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? -1 : i)}
                className="flex w-full items-center justify-between gap-5 rounded-lg px-1 py-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1] focus-visible:ring-offset-2"
              >
                <span className="font-display text-lg font-bold text-[#0A1A2F]">{item.q}</span>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAF2FE] text-[#0B5FD1]"
                  aria-hidden="true"
                >
                  {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!isOpen}
              className="pr-11"
            >
              <p className="px-1 pb-6 text-[15px] leading-relaxed text-[#56657C]">{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
