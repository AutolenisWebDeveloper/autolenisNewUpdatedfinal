// Article + FAQPage JSON-LD for /buying-guide/[slug] pages.
//
// Emits a literal <script type="application/ld+json"> tag so the structured data
// is present in the server-rendered HTML on first byte (the pattern Next.js
// documents for App Router JSON-LD). Mirrors components/seo/landing/JsonLdScript
// — buying-guide pages are indexable and depend on server-rendered schema, so we
// must NOT rely on next/script serialization inside the RSC flight payload.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export interface ArticleSchemaFaq {
  question: string;
  answer: string;
}

export interface ArticleSchemaProps {
  title: string;
  description: string;
  publishedAt: Date | string | null;
  slug: string;
  faqs?: ArticleSchemaFaq[];
}

export default function ArticleSchema({
  title,
  description,
  publishedAt,
  slug,
  faqs = [],
}: ArticleSchemaProps) {
  const url = `${APP_URL}/buying-guide/${slug}`;
  const datePublished =
    publishedAt instanceof Date
      ? publishedAt.toISOString()
      : publishedAt
        ? new Date(publishedAt).toISOString()
        : undefined;

  const graph: Array<Record<string, unknown>> = [
    {
      "@type": "Article",
      headline: title,
      description,
      ...(datePublished ? { datePublished } : {}),
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      publisher: {
        "@type": "Organization",
        name: "AutoLenis",
        url: APP_URL,
      },
    },
  ];

  // Only emit FAQPage when there are real questions — an empty mainEntity is a
  // structured-data warning in Search Console.
  if (faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }

  const data = {
    "@context": "https://schema.org",
    "@graph": graph,
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe; escape "<" defensively to prevent any
      // chance of premature </script> termination from string content.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
