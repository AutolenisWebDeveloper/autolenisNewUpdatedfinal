// Server Component. Visible breadcrumb trail. The matching BreadcrumbList
// JSON-LD is emitted separately on the page via breadcrumbSchema().

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  name: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: Crumb[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="border-b border-slate-100 bg-white">
      <ol className="mx-auto flex max-w-7xl flex-wrap items-center gap-1.5 px-6 py-3 text-sm text-slate-500 md:px-12">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.name} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-[#0B5FD1]">{item.name}</Link>
              ) : (
                <span className={last ? "font-medium text-slate-700" : undefined} aria-current={last ? "page" : undefined}>
                  {item.name}
                </span>
              )}
              {!last && <ChevronRight size={14} className="text-slate-300" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
