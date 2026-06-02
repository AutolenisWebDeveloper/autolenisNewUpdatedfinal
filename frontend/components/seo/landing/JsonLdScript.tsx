// Server Component JSON-LD emitter.
//
// WHY NOT lib/seo/jsonld.tsx's <JsonLd>? That helper uses next/script with
// strategy="beforeInteractive". Outside the root layout, App Router serializes
// those into the RSC flight payload instead of emitting a literal
// <script type="application/ld+json"> in the server-rendered HTML — so the
// structured data is not reliably present for crawlers on first byte.
//
// These pages are INDEXABLE and depend on server-rendered JSON-LD, so we emit a
// literal script tag here (the pattern Next.js documents for App Router JSON-LD).
// We still reuse every schema BUILDER from lib/seo/jsonld.tsx — only the
// rendering mechanism differs.

interface JsonLdScriptProps {
  id: string;
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}

export default function JsonLdScript({ id, data }: JsonLdScriptProps) {
  return (
    <script
      id={id}
      type="application/ld+json"
      // JSON.stringify output is safe; escape "<" defensively to avoid any
      // chance of premature </script> termination from string content.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
