// Apollo.io CSV import — bulk-loads dealer contacts exported from Apollo.io into
// the DealerProspect table.
//
// Why a sentinel buyer opportunity:
//   DealerProspect.buyerOppId is a required FK to BuyerOpportunity (every
//   prospect is normally scoped to the buyer request that surfaced it). An
//   Apollo bulk import has no originating buyer, so — exactly like
//   amips-enrich-dealers.ts — we attach every imported prospect to a single,
//   stable system opportunity keyed by a fixed sessionId. Re-runs reuse it, so
//   the script stays idempotent.
//
// Schema notes (the import spec asked for two fields the schema does not have):
//   - status: the spec said "PROSPECT", but DealerProspect.status is the
//     `DealerProspectStatus` enum (DISCOVERED | SCRIPTED | ... ). New rows are
//     created as DISCOVERED — the same value amips-enrich-dealers.ts uses for a
//     freshly surfaced prospect.
//   - source: DealerProspect has no `source` column. The closest, semantically
//     correct field is `emailSource` (it records where the email address came
//     from), so we stamp imported rows with emailSource = "apollo_import".
//
// Dedup:
//   The table has no compound unique constraint, so we match each row on its
//   natural identity — email first (when the row has one and it already exists
//   in the DB), else name + city + state — and update in place rather than
//   inserting a duplicate.
//
// Requires DATABASE_URL in the environment.
//
// Usage (from frontend/):
//   pnpm apollo:import --file path/to/apollo-export.csv
//   pnpm apollo:import --file path/to/apollo-export.csv --dry-run

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { prisma } from "@/lib/prisma";

// Stable identity for the system opportunity that owns all imported prospects.
const SYSTEM_SESSION_ID = "apollo-import-system";

// ───────────────────────────────────────────────────
// CLI ARGS
// ───────────────────────────────────────────────────

interface CliArgs {
  file: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let file = "";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") {
      file = argv[i + 1] ?? "";
      i++;
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  if (!file) {
    throw new Error(
      "Missing required --file argument.\n" +
        "Usage: pnpm apollo:import --file path/to/apollo-export.csv [--dry-run]",
    );
  }

  return { file, dryRun };
}

// ───────────────────────────────────────────────────
// CSV PARSING (Node built-ins only)
// ───────────────────────────────────────────────────

// Split a single CSV line into fields, honoring double-quoted values that may
// contain commas, escaped quotes ("" inside a quoted field), and surrounding
// whitespace. No external csv library — pure string scanning.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote inside a quoted field => literal ".
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);

  return fields.map((f) => f.trim());
}

interface ApolloRow {
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  city: string;
  state: string;
  email: string;
  corporatePhone: string;
  website: string;
  linkedinUrl: string;
  employees: string;
  industry: string;
}

// Map the Apollo header row to indices so column order changes don't break us.
// Header matching is case-insensitive and whitespace-tolerant.
function buildHeaderMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((name, idx) => {
    map[name.trim().toLowerCase()] = idx;
  });
  return map;
}

function parseCsv(content: string): ApolloRow[] {
  // Normalize line endings, then drop fully blank lines.
  const lines = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headerMap = buildHeaderMap(parseCsvLine(lines[0]));
  const at = (cols: string[], key: string): string => {
    const idx = headerMap[key];
    return idx === undefined ? "" : cols[idx] ?? "";
  };

  const rows: ApolloRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    rows.push({
      firstName: at(cols, "first name"),
      lastName: at(cols, "last name"),
      title: at(cols, "title"),
      company: at(cols, "company"),
      city: at(cols, "city"),
      state: at(cols, "state"),
      email: at(cols, "email"),
      corporatePhone: at(cols, "corporate phone"),
      website: at(cols, "website"),
      linkedinUrl: at(cols, "linkedin url"),
      employees: at(cols, "# employees"),
      industry: at(cols, "industry"),
    });
  }

  return rows;
}

// ───────────────────────────────────────────────────
// FIELD MAPPING
// ───────────────────────────────────────────────────

// Ordered brand rules — first substring match wins. Multi-word/alias keys map to
// a canonical brand label. Matching is case-insensitive on the company name.
const BRAND_RULES: Array<{ needles: string[]; brand: string }> = [
  { needles: ["toyota"], brand: "Toyota" },
  { needles: ["honda"], brand: "Honda" },
  { needles: ["ford"], brand: "Ford" },
  { needles: ["chevrolet", "chevy"], brand: "Chevrolet" },
  { needles: ["ram", "dodge"], brand: "Ram" },
  { needles: ["gmc"], brand: "GMC" },
  { needles: ["kia"], brand: "Kia" },
  { needles: ["hyundai"], brand: "Hyundai" },
  { needles: ["jeep", "chrysler"], brand: "Jeep" },
  { needles: ["lexus"], brand: "Lexus" },
  { needles: ["bmw"], brand: "BMW" },
  { needles: ["mercedes"], brand: "Mercedes" },
  { needles: ["nissan"], brand: "Nissan" },
  { needles: ["subaru"], brand: "Subaru" },
  { needles: ["volkswagen", "vw"], brand: "Volkswagen" },
  { needles: ["mazda"], brand: "Mazda" },
  { needles: ["audi"], brand: "Audi" },
  { needles: ["volvo"], brand: "Volvo" },
];

function deriveBrand(company: string): string {
  const haystack = company.toLowerCase();
  for (const { needles, brand } of BRAND_RULES) {
    if (needles.some((n) => haystack.includes(n))) return brand;
  }
  return "Multi-Brand";
}

interface MappedProspect {
  name: string;
  contactName: string | null;
  contactTitle: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  brand: string;
}

// Collapse empty strings to null so dedup updates only ever overwrite with real
// values (see updateData below).
function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRow(row: ApolloRow): MappedProspect {
  const contactName = [row.firstName.trim(), row.lastName.trim()]
    .filter((p) => p.length > 0)
    .join(" ");

  return {
    name: row.company.trim(),
    contactName: contactName.length > 0 ? contactName : null,
    contactTitle: nullIfEmpty(row.title),
    email: row.email.trim(),
    phone: nullIfEmpty(row.corporatePhone),
    city: nullIfEmpty(row.city),
    state: nullIfEmpty(row.state),
    website: nullIfEmpty(row.website),
    brand: deriveBrand(row.company),
  };
}

// ───────────────────────────────────────────────────
// SYSTEM OPPORTUNITY
// ───────────────────────────────────────────────────

// Ensure the sentinel BuyerOpportunity exists and return its id. Idempotent —
// re-runs reuse the same row (sessionId is unique). Mirrors the pattern in
// amips-enrich-dealers.ts.
async function ensureSystemOpportunity(): Promise<string> {
  const opp = await prisma.buyerOpportunity.upsert({
    where: { sessionId: SYSTEM_SESSION_ID },
    update: {},
    create: {
      sessionId: SYSTEM_SESSION_ID,
      source: "apollo_import",
      firstName: "Apollo Import",
      completed: true,
    },
    select: { id: true },
  });
  return opp.id;
}

// ───────────────────────────────────────────────────
// UPSERT
// ───────────────────────────────────────────────────

type UpsertOutcome = "inserted" | "updated";

// Find an existing prospect by natural identity: email first (when the row has
// one and a matching record exists), else name + city + state.
async function findExisting(p: MappedProspect): Promise<{ id: string } | null> {
  if (p.email) {
    const byEmail = await prisma.dealerProspect.findFirst({
      where: { email: p.email },
      select: { id: true },
    });
    if (byEmail) return byEmail;
  }

  return prisma.dealerProspect.findFirst({
    where: {
      name: p.name,
      city: p.city ?? undefined,
      state: p.state ?? undefined,
    },
    select: { id: true },
  });
}

async function upsertProspect(
  buyerOppId: string,
  p: MappedProspect,
): Promise<UpsertOutcome> {
  const existing = await findExisting(p);

  if (existing) {
    // Update only the fields the spec lists, and only when the incoming value is
    // non-empty — never blank out data we already have.
    const updateData: {
      contactName?: string;
      contactTitle?: string;
      phone?: string;
      website?: string;
    } = {};
    if (p.contactName) updateData.contactName = p.contactName;
    if (p.contactTitle) updateData.contactTitle = p.contactTitle;
    if (p.phone) updateData.phone = p.phone;
    if (p.website) updateData.website = p.website;

    if (Object.keys(updateData).length > 0) {
      await prisma.dealerProspect.update({
        where: { id: existing.id },
        data: updateData,
      });
    }
    return "updated";
  }

  await prisma.dealerProspect.create({
    data: {
      buyerOppId,
      name: p.name,
      contactName: p.contactName,
      contactTitle: p.contactTitle,
      email: p.email,
      phone: p.phone,
      city: p.city,
      state: p.state,
      website: p.website,
      brand: p.brand,
      // status: enum default-equivalent for a freshly surfaced prospect.
      status: "DISCOVERED",
      // source: stamped on emailSource (DealerProspect has no `source` column).
      emailSource: "apollo_import",
    },
  });
  return "inserted";
}

// ───────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const { file, dryRun } = parseArgs(process.argv.slice(2));

  const content = readFileSync(file, "utf8");
  const rows = parseCsv(content);

  console.log(`[apollo-import] File: ${basename(file)}`);
  console.log(`[apollo-import] Rows parsed: ${rows.length}`);

  // Map + filter out rows with no email (the spec skips these).
  const mapped: MappedProspect[] = [];
  let skippedNoEmail = 0;
  for (const row of rows) {
    const p = mapRow(row);
    if (!p.email) {
      skippedNoEmail++;
      continue;
    }
    mapped.push(p);
  }

  console.log(`[apollo-import] Skipped (no email): ${skippedNoEmail}`);

  if (dryRun) {
    // Dry run — show what would be imported without touching the database at all
    // (no connection required). Dedup is a live-DB concern, so every emailed row
    // is reported as a prospective insert here; the real run resolves
    // insert-vs-update against the DB.
    let errors = 0;
    for (const p of mapped) {
      try {
        console.log(
          `[apollo-import]   INSERT  ${p.name} <${p.email}> (${p.brand})` +
            `${p.contactName ? ` — ${p.contactName}` : ""}`,
        );
      } catch (err) {
        errors++;
        console.error(
          `[apollo-import]   ERROR   ${p.name} <${p.email}>:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    console.log("");
    console.log(`[apollo-import] Would insert: ${mapped.length}`);
    console.log(`[apollo-import] Would update: 0`);
    console.log(`[apollo-import] Errors: ${errors}`);
    console.log("[apollo-import] Dry run — no changes written.");
    return;
  }

  const buyerOppId = await ensureSystemOpportunity();
  console.log(`[apollo-import] System opportunity: ${buyerOppId}`);

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  for (const p of mapped) {
    try {
      const outcome = await upsertProspect(buyerOppId, p);
      if (outcome === "inserted") inserted++;
      else updated++;
    } catch (err) {
      errors++;
      console.error(
        `[apollo-import]   ERROR   ${p.name} <${p.email}>:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[apollo-import] Inserted: ${inserted} new dealers`);
  console.log(`[apollo-import] Updated: ${updated} existing dealers`);
  console.log(`[apollo-import] Errors: ${errors}`);
  console.log(
    "[apollo-import] Done. Run pnpm amips:sync-dealers to sync to dealer_intelligence.",
  );
}

main()
  .catch((err) => {
    console.error("[apollo-import] FATAL", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
