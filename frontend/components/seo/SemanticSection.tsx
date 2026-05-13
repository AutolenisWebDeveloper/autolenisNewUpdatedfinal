// Wrapper that creates semantically isolated, AI-extractable content chunks.
// Use to wrap content blocks that should be independently retrievable by
// AI systems and vector databases (RA-SEO content chunks).

import type { ReactNode } from "react";

interface SemanticSectionProps {
  heading: string;
  headingLevel?: "h2" | "h3";
  id?: string;
  children: ReactNode;
  schema?: "article" | "section" | "aside";
}

export default function SemanticSection({
  heading,
  headingLevel = "h2",
  id,
  children,
  schema = "section",
}: SemanticSectionProps) {
  const headingId = id ? `${id}-heading` : undefined;
  const headingClasses = "text-xl font-bold text-slate-900 mb-4";
  const HeadingTag = headingLevel;
  const wrapperProps = {
    id,
    "aria-labelledby": headingId,
    className: "scroll-mt-20 mb-8",
  } as const;

  const headingNode = (
    <HeadingTag id={headingId} className={headingClasses}>
      {heading}
    </HeadingTag>
  );

  if (schema === "article") {
    return (
      <article {...wrapperProps}>
        {headingNode}
        {children}
      </article>
    );
  }
  if (schema === "aside") {
    return (
      <aside {...wrapperProps}>
        {headingNode}
        {children}
      </aside>
    );
  }
  return (
    <section {...wrapperProps}>
      {headingNode}
      {children}
    </section>
  );
}
