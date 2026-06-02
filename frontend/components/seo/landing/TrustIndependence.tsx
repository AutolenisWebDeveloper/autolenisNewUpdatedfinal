// Server Component. Independence / alignment-of-incentives trust block.

import { ShieldCheck, HandCoins, Lock } from "lucide-react";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "We work for you, not the dealer",
    text: "AutoLenis is your buyer's agent. Our job is to get you the right vehicle at the best out-the-door price — full stop.",
  },
  {
    icon: HandCoins,
    title: "Zero dealer kickbacks",
    text: "We take no dealer commissions for steering you. Dealers earn your business by competing on price, not by paying us to send you their way.",
  },
  {
    icon: Lock,
    title: "We never sell your data",
    text: "Your information is used to run your request and nothing else. We don't resell leads or hand your details to a list of dealers.",
  },
];

export default function TrustIndependence() {
  return (
    <section id="independence" className="scroll-mt-20 bg-slate-900 py-16 text-white md:py-20">
      <div className="mx-auto max-w-5xl px-6 md:px-12">
        <h2 className="text-2xl font-bold sm:text-3xl">Whose side are we on? Yours.</h2>
        <p className="mt-3 max-w-2xl text-slate-300">
          The traditional model pits you against the dealership alone. We flip it.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {POINTS.map((p) => (
            <div key={p.title} className="rounded-xl border border-white/10 bg-white/5 p-6">
              <p.icon size={26} className="text-[#4DA3FF]" />
              <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
