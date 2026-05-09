// Strip <!--META:{...}--> blob from System 4C notes and parse the JSON, leaving
// only the human-readable lines. The wizard at /buyer/requests/new packs extra
// metadata into the notes column inside an HTML comment so the backend doesn't
// need a schema migration. Since pages render notes as text, we parse on read.

export interface RequestNotesMeta {
  vehicleType?: string;
  condition?: string;
  timeline?: string;
  zip?: string | null;
  downPaymentCents?: number | null;
  monthlyTargetCents?: number | null;
  trim?: string | null;
  maxMileage?: number | null;
  features?: string[];
}

export interface ParsedRequestNotes {
  text: string;             // human-readable lines, newlines preserved
  meta: RequestNotesMeta | null;
}

const META_RE = /<!--\s*META:(\{[\s\S]*?\})\s*-->/;

export function parseRequestNotes(raw: string | null | undefined): ParsedRequestNotes {
  if (!raw) return { text: "", meta: null };
  const match = raw.match(META_RE);
  let meta: RequestNotesMeta | null = null;
  if (match) {
    try {
      meta = JSON.parse(match[1]) as RequestNotesMeta;
    } catch {
      meta = null;
    }
  }
  const text = raw.replace(META_RE, "").trim();
  return { text, meta };
}
