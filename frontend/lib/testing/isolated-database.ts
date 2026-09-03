// Isolation guard for destructive database tests.
//
// WHY THIS EXISTS
// `select-offer-concurrency.test.ts` seeds users, buyers, deposits, auctions, dealers and offers,
// five rounds at a time, and deletes none of it. Its only safety check was
// `!dsn.includes("placeholder")`, so ANY reachable database — including production — satisfied it,
// and CI supplies `secrets.DATABASE_URL || <placeholder>`. A denylist cannot make that safe: it
// only refuses the shapes someone thought of. So this guard is an ALLOWLIST. A database is
// acceptable only when it positively identifies itself as a disposable local target; everything
// else, including anything unparseable, is refused before a connection is opened.
//
// The guard is a pure function of the connection string. It opens no socket, imports no client,
// and therefore cannot write anything on the refusal path.
//
// LIMIT, stated rather than implied: this reasons about the DSN, not about what answers on the far
// end. A loopback proxy or tunnel deliberately forwarding to a remote database would satisfy it. That
// is not a hole this layer can close — nothing readable from the connection string distinguishes the
// two — so the run-tagging and cleanup below are the second line of defence: every row a run creates
// is removable by tag, and a run that cannot remove its own rows fails loudly.

/** The production Supabase project. Named explicitly so a refusal is unambiguous in the log. */
export const PRODUCTION_PROJECT_REF = "aieybibvewmvrubcpthm";

/** Database names that must never be a destructive-test target, whatever the host claims. */
export const PRODUCTION_DATABASE_NAMES = new Set(["postgres", "autolenis", "autolenis_prod", "autolenis_production", "railway", "defaultdb"]);

/** Only these hosts can hold a disposable target. Loopback only — never a network address. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

/**
 * A disposable database must be named this way. The name is the positive identification: it is
 * not a name any real environment uses, and creating it is a deliberate act.
 */
export const ISOLATED_DATABASE_PATTERN = /^autolenis_e2e(_[a-z0-9][a-z0-9-]*)?$/;

export class ProductionDatabaseRefusedError extends Error {
  readonly reason: string;
  readonly target: SanitizedTarget | null;
  constructor(reason: string, target: SanitizedTarget | null) {
    super(
      `refusing to run a destructive test against this database: ${reason}` +
        (target ? ` (host=${target.host} database=${target.database} projectRef=${target.projectRef ?? "none"})` : ""),
    );
    this.name = "ProductionDatabaseRefusedError";
    this.reason = reason;
    this.target = target;
  }
}

/** Host, database and project reference only. Never the user, password, or full DSN. */
export interface SanitizedTarget {
  host: string;
  port: string;
  database: string;
  projectRef: string | null;
}

/**
 * Extract the Supabase project reference, which can appear either in the host
 * (`db.<ref>.supabase.co`, `aws-0-<region>.pooler.supabase.com`) or in the username
 * (`postgres.<ref>` — the pooler form, where the host carries no ref at all).
 */
function extractProjectRef(url: URL): string | null {
  const hostMatch = url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.(co|com|net)$/i);
  if (hostMatch) return hostMatch[1].toLowerCase();
  const userMatch = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]{20})$/i);
  if (userMatch) return userMatch[1].toLowerCase();
  const anyRef = url.hostname.match(/\b([a-z]{20})\b/);
  return anyRef ? anyRef[1].toLowerCase() : null;
}

/** Parse a DSN into a sanitized target. Throws on anything that is not a usable postgres URL. */
export function parseDatabaseTarget(dsn: string | undefined | null): SanitizedTarget {
  if (dsn === undefined || dsn === null || dsn.trim() === "") {
    throw new ProductionDatabaseRefusedError("no connection string is configured", null);
  }
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new ProductionDatabaseRefusedError("connection string is not a parseable URL", null);
  }
  if (!/^postgres(ql)?:$/i.test(url.protocol)) {
    throw new ProductionDatabaseRefusedError(`connection string is not postgres (scheme ${url.protocol})`, null);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") {
    throw new ProductionDatabaseRefusedError("connection string names no database", null);
  }
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database,
    projectRef: extractProjectRef(url),
  };
}

/**
 * Refuse unless the target positively identifies itself as a disposable local database.
 * Returns the sanitized target on success; throws ProductionDatabaseRefusedError otherwise.
 * Opens no connection, so a refusal cannot have written anything.
 */
export function assertIsolatedDatabase(dsn: string | undefined | null): SanitizedTarget {
  const target = parseDatabaseTarget(dsn); // throws on missing / unparseable

  if (target.projectRef === PRODUCTION_PROJECT_REF) {
    throw new ProductionDatabaseRefusedError(`project reference ${PRODUCTION_PROJECT_REF} is production`, target);
  }
  if (/\.supabase\.(co|com|net)$/i.test(target.host)) {
    throw new ProductionDatabaseRefusedError("host is a Supabase endpoint, never a disposable target", target);
  }
  if (PRODUCTION_DATABASE_NAMES.has(target.database.toLowerCase())) {
    throw new ProductionDatabaseRefusedError(`database name "${target.database}" is a production name`, target);
  }
  // Allowlist from here: everything must be positively identified.
  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new ProductionDatabaseRefusedError(`host "${target.host}" is not loopback`, target);
  }
  if (!ISOLATED_DATABASE_PATTERN.test(target.database)) {
    throw new ProductionDatabaseRefusedError(
      `database "${target.database}" does not match the reserved disposable pattern ${ISOLATED_DATABASE_PATTERN}`,
      target,
    );
  }
  return target;
}

/** True when a destructive suite may run. Never throws — for `skip:` conditions. */
export function isolatedDatabaseOrNull(dsn: string | undefined | null): SanitizedTarget | null {
  try {
    return assertIsolatedDatabase(dsn);
  } catch {
    return null;
  }
}

/** Human-readable, credential-free description for logs and reports. */
export function describeTarget(target: SanitizedTarget): string {
  return `host=${target.host} port=${target.port} database=${target.database} projectRef=${target.projectRef ?? "none"}`;
}

/**
 * A unique tag for every row a run creates, so cleanup can find its own rows and only its own.
 * Embedded in the natural-key columns the seed already sets (supabaseId, email, names).
 */
export function newRunTag(prefix = "isotest"): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/**
 * Delete order for the entities the concurrency suite creates. Children first: every row is
 * reachable from the tagged users, and deleting a parent before its children would fail on the
 * foreign keys rather than clean up.
 */
export const CLEANUP_ORDER = [
  "dealStatusHistory",
  "deal",
  "offer",
  "auction",
  "deposit",
  "dealer",
  "buyer",
  "user",
] as const;

export type CleanupClient = {
  [K in (typeof CLEANUP_ORDER)[number]]: {
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
} & {
  deal: { findMany: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }[]> };
};

/**
 * `DealStatusHistory` is the one model with no relation back to `Deal` — `deal_id` is a bare column
 * with no foreign key (verified in schema.prisma and in pg_constraint), so it cannot be reached by a
 * nested filter the way every other model can. Its rows are selected by the ids of the tagged deals,
 * which must therefore be read BEFORE the deals are deleted. Children-first order already guarantees
 * that: history is the first entry in CLEANUP_ORDER.
 */
export interface TaggedRunContext {
  dealIds: string[];
}

/** Where-clause that selects exactly the rows a run tagged, per model. */
export function taggedWhere(
  model: (typeof CLEANUP_ORDER)[number],
  runTag: string,
  context: TaggedRunContext = { dealIds: [] },
): Record<string, unknown> {
  switch (model) {
    case "user":
      return { supabaseId: { startsWith: runTag } };
    case "buyer":
      return { user: { supabaseId: { startsWith: runTag } } };
    case "dealer":
      return { user: { supabaseId: { startsWith: runTag } } };
    case "deposit":
      return { buyer: { user: { supabaseId: { startsWith: runTag } } } };
    case "auction":
      return { buyer: { user: { supabaseId: { startsWith: runTag } } } };
    case "offer":
      return { auction: { buyer: { user: { supabaseId: { startsWith: runTag } } } } };
    case "deal":
      return { offer: { auction: { buyer: { user: { supabaseId: { startsWith: runTag } } } } } };
    case "dealStatusHistory":
      // An empty id list matches nothing, which is the correct answer when the run made no deals.
      return { dealId: { in: context.dealIds } };
  }
}

/** Read the ids of the deals this run created, so the unlinked history rows can be found. */
export async function taggedRunContext(client: CleanupClient, runTag: string): Promise<TaggedRunContext> {
  const deals = await client.deal.findMany({ where: taggedWhere("deal", runTag), select: { id: true } });
  return { dealIds: deals.map((d) => d.id) };
}

/** Raised when cleanup could not remove everything. Names every model that failed. */
export class CleanupFailedError extends Error {
  readonly runTag: string;
  readonly failures: string[];
  readonly deleted: Record<string, number>;
  constructor(runTag: string, failures: string[], deleted: Record<string, number>) {
    super(`cleanup for run ${runTag} failed on ${failures.length} model(s): ${failures.join("; ")}`);
    this.name = "CleanupFailedError";
    this.runTag = runTag;
    this.failures = failures;
    this.deleted = deleted;
  }
}

/**
 * Delete every row this run tagged, children first. Returns the per-model delete counts.
 *
 * Every model is attempted even when an earlier one throws. The first version stopped at the first
 * failure, so one bad where-clause abandoned the remaining seven models and left a full run's rows
 * in the database with nothing but a confusing error to show for it. Failures are collected and
 * raised together at the end, so a partial cleanup is loud and names exactly what went wrong.
 */
export async function cleanupRunTag(
  client: CleanupClient,
  runTag: string,
  known?: TaggedRunContext,
): Promise<Record<string, number>> {
  const describe = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));
  const failures: string[] = [];

  let context: TaggedRunContext = known ?? { dealIds: [] };
  if (!known) {
    try {
      context = await taggedRunContext(client, runTag);
    } catch (err) {
      failures.push(`deal.findMany: ${describe(err)}`);
    }
  }

  const deleted: Record<string, number> = {};
  for (const model of CLEANUP_ORDER) {
    try {
      const { count } = await client[model].deleteMany({ where: taggedWhere(model, runTag, context) });
      deleted[model] = count;
    } catch (err) {
      deleted[model] = 0;
      failures.push(`${model}: ${describe(err)}`);
    }
  }
  if (failures.length > 0) throw new CleanupFailedError(runTag, failures, deleted);
  return deleted;
}

/**
 * Count rows still carrying this run's tag. Must be zero after cleanup.
 *
 * `known` MUST be supplied when counting after a cleanup. `deal_status_history` has no foreign key
 * to `deals`, so deleting a deal does not remove its history rows — and once the deals are gone,
 * re-resolving the id list yields `[]`, which makes surviving history rows count as zero. Passing
 * the ids captured *before* the deletes is what turns that silent leak into a failure.
 */
export async function countRunTag(
  client: CleanupClient,
  runTag: string,
  known?: TaggedRunContext,
): Promise<number> {
  const context = known ?? (await taggedRunContext(client, runTag));
  let remaining = 0;
  for (const model of CLEANUP_ORDER) {
    remaining += await client[model].count({ where: taggedWhere(model, runTag, context) });
  }
  return remaining;
}

/**
 * Run `body` with a fresh tag and clean up afterwards WHETHER OR NOT it throws, then assert the
 * run left nothing behind. A failing body must not leave rows: that is how one red test turns a
 * shared database into a landfill.
 */
export async function withTaggedRun<T>(
  client: CleanupClient,
  body: (runTag: string) => Promise<T>,
  options: { prefix?: string } = {},
): Promise<T> {
  const runTag = newRunTag(options.prefix);
  let result: T;
  try {
    result = await body(runTag);
  } catch (bodyError) {
    // The body already failed. Clean up anyway, but never let a cleanup problem hide the real cause:
    // a `finally` that throws replaces the original error, which is how a red test becomes a mystery.
    try {
      await cleanupRunTag(client, runTag);
    } catch (cleanupError) {
      const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      if (bodyError instanceof Error) bodyError.message += `\n[cleanup also failed] ${detail}`;
    }
    throw bodyError;
  }
  // Capture the deal ids BEFORE the deletes, and count against that same list afterwards.
  const context = await taggedRunContext(client, runTag);
  await cleanupRunTag(client, runTag, context);
  const remaining = await countRunTag(client, runTag, context);
  if (remaining !== 0) {
    throw new Error(`cleanup left ${remaining} tagged row(s) behind for run ${runTag}`);
  }
  return result;
}
