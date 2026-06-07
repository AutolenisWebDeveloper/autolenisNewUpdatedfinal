// AMIPS Phase 2 — minimal Markdown → sanitized HTML renderer.
//
// The AMIPS generator asks the model for a Markdown body (headings, paragraphs,
// lists, bold/links, and the occasional table). The public /intelligence/[slug]
// route renders the stored body with dangerouslySetInnerHTML, mirroring the
// existing buying-guide route, so we convert Markdown to a small, hardened HTML
// subset at generation time. No external dependency — deterministic and
// unit-testable.
//
// Supported block constructs: ## / ### headings, unordered (-, *) and ordered
// (1.) lists, GitHub-style pipe tables, and paragraphs. Supported inline
// constructs: **bold**, *italic*, [text](url), and `code`. Everything else is
// emitted as escaped text inside a <p>.

// Tags the renderer is allowed to emit. Anything the model smuggles in as raw
// HTML is escaped before conversion, so the output can only contain these.
const ALLOWED_TAGS = new Set([
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "code",
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convert inline Markdown on an already HTML-escaped string. Order matters:
// links first (so URL parens are not eaten by emphasis), then bold, then
// italic, then inline code.
function renderInline(escaped: string): string {
  let out = escaped;

  // [text](http(s)://url) — only http/https/relative URLs are allowed.
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text: string, href: string) => {
      const safe = /^(https?:\/\/|\/)/i.test(href) ? href : "#";
      return `<a href="${safe}">${text}</a>`;
    },
  );

  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic* (single asterisk, not part of a **)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  // `code`
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

  return out;
}

function renderTable(rows: string[]): string {
  // rows[0] = header, rows[1] = separator (---), rows[2..] = body.
  const splitRow = (line: string): string[] =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());

  const header = splitRow(rows[0]);
  const bodyRows = rows.slice(2).map(splitRow);

  const thead =
    "<thead><tr>" +
    header.map((c) => `<th>${renderInline(escapeHtml(c))}</th>`).join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    bodyRows
      .map(
        (cells) =>
          "<tr>" +
          cells.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join("") +
          "</tr>",
      )
      .join("") +
    "</tbody>";

  return `<table>${thead}${tbody}</table>`;
}

function renderList(items: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const lis = items
    .map((it) => `<li>${renderInline(escapeHtml(it))}</li>`)
    .join("");
  return `<${tag}>${lis}</${tag}>`;
}

/**
 * Convert a Markdown string into a small, sanitized HTML subset.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];

  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let tableRows: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    if (text) blocks.push(`<p>${renderInline(escapeHtml(text))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(renderList(listItems, listOrdered));
    listItems = [];
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    // A valid table needs a header + separator + at least one body row.
    if (tableRows.length >= 3 && /^\s*\|?[\s:-]+\|/.test(tableRows[1])) {
      blocks.push(renderTable(tableRows));
    } else {
      // Not a real table — fall back to paragraph text.
      for (const r of tableRows) {
        blocks.push(`<p>${renderInline(escapeHtml(r.trim()))}</p>`);
      }
    }
    tableRows = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Blank line — close any open block.
    if (line.trim() === "") {
      flushAll();
      continue;
    }

    // Table row.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      tableRows.push(line);
      continue;
    } else if (tableRows.length > 0) {
      flushTable();
    }

    // Headings.
    const h3 = line.match(/^###\s+(.*)$/);
    const h2 = line.match(/^##\s+(.*)$/);
    if (h3) {
      flushAll();
      blocks.push(`<h3>${renderInline(escapeHtml(h3[1].trim()))}</h3>`);
      continue;
    }
    if (h2) {
      flushAll();
      blocks.push(`<h2>${renderInline(escapeHtml(h2[1].trim()))}</h2>`);
      continue;
    }
    // A single leading "# " (h1) — the page renders its own <h1>, so demote to h2.
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      flushAll();
      blocks.push(`<h2>${renderInline(escapeHtml(h1[1].trim()))}</h2>`);
      continue;
    }

    // Ordered list item.
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (!listOrdered) flushList();
      listOrdered = true;
      listItems.push(ol[1].trim());
      continue;
    }
    // Unordered list item.
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (listOrdered) flushList();
      listOrdered = false;
      listItems.push(ul[1].trim());
      continue;
    }

    // Otherwise — paragraph text.
    flushList();
    paragraph.push(line.trim());
  }

  flushAll();

  // Defense in depth: the converter only emits ALLOWED_TAGS, but assert it so a
  // future edit can't silently widen the surface.
  return blocks
    .join("\n")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (tag, nameRaw) => {
      const name = String(nameRaw).toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";
      return tag
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/javascript:/gi, "");
    });
}
