// Server Component. The concierge capability grid — what AutoLenis does as your
// buyer's agent. Maps conceptually to the Service offerings in JSON-LD.

import { Search, Gavel, Handshake, Landmark, Car } from "lucide-react";
import { CONCIERGE_CAPABILITIES } from "./content";

const ICONS = [Search, Gavel, Handshake, Landmark, Car];

export default function WhatWeDoConcierge() {
  return (
    <section id="what-we-do" className="scroll-mt-20 bg-slate-50 py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6 md:px-12">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          What your concierge does for you
        </h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          AutoLenis is a buyer-side car-buying concierge and reverse-auction platform —
          a car buyer&apos;s agent that handles the parts you dread.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CONCIERGE_CAPABILITIES.map((cap, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <div key={cap.title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#0B5FD1]/10 text-[#0B5FD1]">
                  <Icon size={22} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{cap.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{cap.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
