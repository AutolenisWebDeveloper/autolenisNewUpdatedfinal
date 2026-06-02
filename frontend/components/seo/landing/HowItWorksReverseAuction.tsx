// Server Component. Visible reverse-auction steps — maps 1:1 to the HowTo
// JSON-LD built from REVERSE_AUCTION_STEPS so visible content and schema match.

import { REVERSE_AUCTION_STEPS } from "./content";

export default function HowItWorksReverseAuction() {
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-6 md:px-12">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          How the reverse auction works
        </h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          One request puts verified dealers to work for you. Here is the whole process,
          start to finish.
        </p>

        <ol className="mt-10 space-y-6">
          {REVERSE_AUCTION_STEPS.map((step, i) => (
            <li key={step.name} className="flex gap-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0B5FD1] text-lg font-bold text-white">
                {i + 1}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{step.name}</h3>
                <p className="mt-1 text-slate-600">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
