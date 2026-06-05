// Minimal, XSS-safe markdown renderer for buying-guide article bodies.
//
// Phase C2 stores article.body as markdown. The project has no markdown
// dependency, so rather than pull one in (or use dangerouslySetInnerHTML on
// model output), we parse the small subset the generator emits into real React
// elements. Text is never injected as HTML — React escapes it — so model output
// cannot inject markup. Supported: ## / ### headings, - / * and 1. lists,
// blank-line paragraphs, **bold**, and [text](url) links.

import React from "react";
import Link from "next/link";

interface ArticleBodyProps {
  markdown: string;
}

// Parse inline **bold** and [text](url) into React nodes.
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Alternating match on bold or link; everything else is literal text.
  const pattern = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[2] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{match[2]}</strong>);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const href = match[5];
      const isInternal = href.startsWith("/");
      nodes.push(
        isInternal ? (
          <Link key={`${keyPrefix}-l${i}`} href={href} className="text-[#0B5FD1] underline">
            {match[4]}
          </Link>
        ) : (
          <a
            key={`${keyPrefix}-l${i}`}
            href={href}
            className="text-[#0B5FD1] underline"
            rel="noopener noreferrer"
          >
            {match[4]}
          </a>
        ),
      );
    }
    lastIndex = pattern.lastIndex;
    i += 1;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export default function ArticleBody({ markdown }: ArticleBodyProps) {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];

  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    blocks.push(
      <p key={`p${key++}`} className="my-4 leading-relaxed text-slate-700">
        {renderInline(text, `p${key}`)}
      </p>,
    );
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    const cls = "my-4 ml-6 space-y-1.5 text-slate-700";
    blocks.push(
      listOrdered ? (
        <ol key={`l${key++}`} className={`list-decimal ${cls}`}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`l${key++}`} className={`list-disc ${cls}`}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </ul>
      ),
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Blank line → end of current block.
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const h3 = /^###\s+(.*)$/.exec(line);
    const h2 = /^##\s+(.*)$/.exec(line);
    const h1 = /^#\s+(.*)$/.exec(line);
    const ulItem = /^[-*]\s+(.*)$/.exec(line);
    const olItem = /^\d+\.\s+(.*)$/.exec(line);

    if (h3) {
      flushParagraph();
      flushList();
      blocks.push(
        <h3 key={`h${key++}`} className="mt-6 mb-2 text-xl font-semibold text-slate-900">
          {renderInline(h3[1], `h${key}`)}
        </h3>,
      );
    } else if (h2) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2 key={`h${key++}`} className="mt-8 mb-3 text-2xl font-bold text-slate-900">
          {renderInline(h2[1], `h${key}`)}
        </h2>,
      );
    } else if (h1) {
      // The page renders its own <h1> from article.h1; demote a body-level
      // "# " to an h2 so there's never a second document <h1>.
      flushParagraph();
      flushList();
      blocks.push(
        <h2 key={`h${key++}`} className="mt-8 mb-3 text-2xl font-bold text-slate-900">
          {renderInline(h1[1], `h${key}`)}
        </h2>,
      );
    } else if (ulItem || olItem) {
      flushParagraph();
      const ordered = Boolean(olItem);
      if (listItems.length > 0 && ordered !== listOrdered) {
        flushList();
      }
      listOrdered = ordered;
      listItems.push((ulItem ?? olItem)![1]);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }

  flushParagraph();
  flushList();

  return <div className="text-base">{blocks}</div>;
}
