import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.hope);

// System 25 — Faith & Encouragement Brand Layer
// CRITICAL: Born-again invitation appears ONLY on this page.
// It must NEVER appear on any other AutoLenis page.
// This page is serene, elegant, non-coercive. No sales CTAs.

export default function HopePage() {
  return (
    <article className="max-w-2xl mx-auto px-6 py-20 md:py-32" data-testid="hope-page">

      {/* Section 1: Opening Statement */}
      <section data-testid="hope-opening" className="mb-16">
        <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-6">A Word of Encouragement</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-6 leading-tight">
          Buying a car is a big step.<br />You don&apos;t have to navigate it alone.
        </h1>
        <p className="text-slate-600 text-base leading-relaxed mb-4">
          AutoLenis was built to remove the stress, uncertainty, and manipulation from one of life&apos;s significant financial decisions. But we also believe that real peace — in any area of life — runs deeper than a good deal.
        </p>
        <p className="text-slate-600 text-base leading-relaxed">
          This page exists for those moments when you need more than a transaction. We hope these words find you well.
        </p>
      </section>

      {/* Section 2: Encouragement Content */}
      <section data-testid="hope-encouragement" className="mb-16 bg-slate-50 rounded-2xl p-8 md:p-10">
        <p className="text-xs tracking-widest uppercase font-semibold text-slate-400 mb-5">Words of Encouragement</p>
        <div className="space-y-8">
          <blockquote className="border-l-2 border-[#0B5FD1]/30 pl-6">
            <p className="text-lg text-slate-700 italic leading-relaxed mb-2">
              &ldquo;For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.&rdquo;
            </p>
            <cite className="text-sm font-semibold text-[#0B5FD1]/70 not-italic">Jeremiah 29:11 — NKJV</cite>
          </blockquote>
          <blockquote className="border-l-2 border-[#0B5FD1]/30 pl-6">
            <p className="text-lg text-slate-700 italic leading-relaxed mb-2">
              &ldquo;Trust in the Lord with all your heart, and lean not on your own understanding; in all your ways acknowledge Him, and He shall direct your paths.&rdquo;
            </p>
            <cite className="text-sm font-semibold text-[#0B5FD1]/70 not-italic">Proverbs 3:5–6 — NKJV</cite>
          </blockquote>
          <p className="text-slate-600 text-sm leading-relaxed">
            Whatever circumstances bring you to this page today — whether a major purchase, a difficult decision, or simply a quiet moment — we hope these words offer some steadiness for what lies ahead.
          </p>
        </div>
      </section>

      {/* Section 3: Born-Again Invitation — ONLY on /hope */}
      <section data-testid="hope-born-again-invitation" className="mb-16 border border-[#0B5FD1]/15 rounded-2xl p-8 md:p-10">
        <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-5">An Invitation</p>
        <h2 className="text-xl font-semibold text-slate-900 mb-4 leading-snug">
          Have you considered a relationship with God?
        </h2>
        <p className="text-slate-600 text-sm leading-relaxed mb-4">
          The AutoLenis team includes people of faith who believe that lasting hope, identity, and peace are found not in circumstances, but in a relationship with Jesus Christ. We share this not to persuade, but as an honest expression of what sustains us.
        </p>
        <p className="text-slate-600 text-sm leading-relaxed mb-4">
          The Bible describes this as being &ldquo;born again&rdquo; — a renewal of the heart that brings peace, purpose, and a new relationship with God. It is available to anyone, at any point in their story.
        </p>
        <p className="text-slate-600 text-sm leading-relaxed mb-6">
          If this is something you want to explore further, the resources below offer a gentle starting point. There is no obligation and no sales pitch — only an invitation.
        </p>
        <p className="text-slate-400 text-xs">
          This invitation is offered with respect for your beliefs and choices. You are always welcome here regardless of your faith background.
        </p>
      </section>

      {/* Section 4: Encouragement Resources */}
      <section data-testid="hope-resources" className="mb-12">
        <p className="text-xs tracking-widest uppercase font-semibold text-slate-400 mb-6">Resources</p>
        <div className="space-y-4">
          {[
            { title: "The Bible (Online)", body: "Read or listen to scripture in many translations.", href: "https://www.biblegateway.com", external: true },
            { title: "YouVersion Bible App", body: "A free app with reading plans, devotionals, and community.", href: "https://www.youversion.com", external: true },
            { title: "BibleProject", body: "Free videos and podcasts exploring the themes of scripture.", href: "https://bibleproject.com", external: true },
          ].map((r) => (
            <a key={r.title} href={r.href} target={r.external ? "_blank" : undefined} rel={r.external ? "noopener noreferrer" : undefined}
              data-testid={`hope-resource-${r.title.toLowerCase().replace(/\s+/g, "-")}`}
              className="flex items-start justify-between gap-4 p-5 border border-slate-200 rounded-xl hover:border-[#0B5FD1] hover:shadow-sm transition-all group">
              <div>
                <p className="font-semibold text-slate-900 text-sm mb-1 group-hover:text-[#0B5FD1] transition-colors">{r.title}</p>
                <p className="text-xs text-slate-500">{r.body}</p>
              </div>
              <span className="text-slate-300 text-xs shrink-0 mt-0.5">↗</span>
            </a>
          ))}
        </div>
      </section>

      <div className="text-center pt-8 border-t border-slate-100">
        <Link href="/" data-testid="hope-back-home" className="text-sm text-[#0B5FD1] font-medium hover:underline">
          ← Back to AutoLenis
        </Link>
      </div>
    </article>
  );
}
