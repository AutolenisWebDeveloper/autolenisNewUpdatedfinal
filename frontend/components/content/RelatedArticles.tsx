import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { type RelatedArticleLink, relationLabel } from "@/lib/seo/internal-links";

// Phase C4 — lateral internal links between programmatic articles. Renders the
// ranked related set (see lib/seo/internal-links.ts). Server component: no
// interactivity, just crawlable <a> links that build the topical link graph.

export default function RelatedArticles({
  links,
}: {
  links: RelatedArticleLink[];
}) {
  if (links.length === 0) return null;

  return (
    <section className="mt-16" data-testid="article-internal-links">
      <h2 className="text-xl font-bold text-[#111827] tracking-tight mb-5">
        Related guides
      </h2>
      <ul className="grid sm:grid-cols-2 gap-4">
        {links.map((link) => (
          <li key={link.slug}>
            <Link
              href={`/buying-guide/${link.slug}`}
              data-testid="article-internal-link"
              className="block rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#0B5FD1] hover:shadow-sm transition-all"
            >
              <span className="text-[11px] tracking-wide uppercase font-semibold text-[#6B7280]">
                {relationLabel(link.reason)}
              </span>
              <span className="mt-1 block text-sm font-semibold text-[#111827]">
                {link.title}
              </span>
              <span className="mt-2 flex items-center gap-1 text-xs text-[#0B5FD1]">
                Read guide <ArrowRight size={12} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
