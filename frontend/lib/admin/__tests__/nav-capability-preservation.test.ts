// lib/admin/__tests__/nav-capability-preservation.test.ts
//
// The Batch 2 acceptance gate, as an executable control.
//
// The owner's condition for consolidating admin navigation was that no working
// capability may become unreachable. That is not a claim you can make by
// inspection over 139 pages, so it is asserted here: this suite walks
// app/admin/**/page.tsx on disk, resolves every /admin/... link literal in the
// app the way Next.js resolves routes, and proves that each page is either a
// rail entry or is genuinely linked from the parent lib/admin/nav.ts names.
//
// If someone later deletes a hub link, this fails — instead of a page silently
// falling out of the product.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import {
  ALL_SECTIONS,
  HUB_PARENTS,
  DETAIL_PARENTS,
  LEGACY_REDIRECTS,
  EXTERNAL_ENTRY_ROUTES,
  AUTH_ROUTES,
  ADMIN_LANDING,
  railHrefs,
  isNavItemActive,
  isNavItemVisible,
  sectionForPathname,
} from "../nav";
import { BASELINE_ADMIN_ROUTES } from "./baseline-routes";

const APP = join(process.cwd(), "app");
const ADMIN = join(APP, "admin");

/** Every admin route that exists on disk, as a URL path. */
function discoverRoutes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) discoverRoutes(full, acc);
    else if (entry === "page.tsx" || entry === "page.ts") {
      acc.push("/" + relative(APP, dirname(full)).split("\\").join("/"));
    }
  }
  return acc;
}

const ROUTES = discoverRoutes(ADMIN).sort();

/** Next.js route precedence: static segments beat dynamic, left to right. */
function segments(route: string): string[] {
  return route.replace(/^\//, "").split("/");
}
const BY_LENGTH = new Map<number, { route: string; re: RegExp }[]>();
for (const route of [...ROUTES].sort((a, b) => {
  const sa = segments(a);
  const sb = segments(b);
  if (sa.length !== sb.length) return sa.length - sb.length;
  for (let i = 0; i < sa.length; i++) {
    const da = sa[i].startsWith("[") ? 1 : 0;
    const db = sb[i].startsWith("[") ? 1 : 0;
    if (da !== db) return da - db;
  }
  return a.localeCompare(b);
})) {
  const segs = segments(route);
  const re = new RegExp(
    "^/" +
      segs
        .map((s) => (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("/") +
      "$",
  );
  const list = BY_LENGTH.get(segs.length) ?? [];
  list.push({ route, re });
  BY_LENGTH.set(segs.length, list);
}

/** Resolve a concrete URL to the admin route that would serve it. */
function resolveRoute(url: string): string | null {
  const n = segments(url).length;
  for (const { route, re } of BY_LENGTH.get(n) ?? []) {
    if (re.test(url)) return route;
  }
  return null;
}

/**
 * A complete quoted string that is an /admin URL. Deliberately strict — the
 * dead-link audit uses it, and a looser pattern would flag routes merely named
 * in prose or comments.
 */
const LITERAL = /['"`](\/admin(?:\/[^'"`\s]*)?)['"`]/g;

/**
 * An /admin URL appearing anywhere inside a string, including after an
 * interpolation such as `${APP_URL}/admin/vehicle-requests/${id}`. Used only to
 * find EVIDENCE that a link exists, never to prove one is dead. The lookbehind
 * keeps `/api/admin/...` endpoints and `@/components/admin/...` import
 * specifiers out of the results.
 */
const EMBEDDED_URL = /(?<![\w/])(\/admin(?:\/[^'"`\s]*)?)/g;

/**
 * Every /admin URL referenced by a file, normalised and route-resolved.
 *
 * Two link styles have to be understood, because the console uses both:
 *   href={`/admin/buyers/${b.id}`}   — template literal
 *   href={"/admin/buyers/" + b.id}   — string concatenation
 * The second leaves a literal with a trailing slash, so a literal ending in "/"
 * is also tried with one synthetic dynamic segment appended. Missing this is
 * what makes a link audit report false orphans.
 */
function linkedRoutesIn(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(EMBEDDED_URL)) {
      const raw = m[1]
        .split("?")[0]
        .split("#")[0]
        // `${encodeURIComponent(make)}` contains parens, so collapse whole
        // interpolations to one segment token before anything else.
        .replace(/\$\{[^{}]*\}/g, "X")
        // Whatever follows the URL in the source (a closing brace, paren,
        // quote, JSX) is not part of the path.
        .replace(/[^A-Za-z0-9/_.$[\]-]+$/, "");
      const trailingSlash = raw.endsWith("/") && raw !== "/admin/";
      const url = raw.replace(/\/$/, "") || "/admin";
      const direct = resolveRoute(url);
      if (direct) found.add(direct);
      if (trailingSlash) {
        const concatenated = resolveRoute(`${url}/X`);
        if (concatenated) found.add(concatenated);
      }
    }
  }
  return found;
}

/**
 * The files a route "owns": its own page plus co-located components, but NOT
 * nested directories that are themselves routes (those belong to the child).
 */
function ownedFiles(route: string): string[] {
  const dir = join(APP, route.replace(/^\//, ""));
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        const asRoute = "/" + relative(APP, full).split("\\").join("/");
        // Descend only into directories that are not themselves a route root.
        if (!ROUTES.some((r) => r === asRoute || r.startsWith(asRoute + "/"))) walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Shared components are not owned by a route but do carry its links. */
const SHARED_COMPONENT_DIRS = [join(process.cwd(), "components", "admin")];
function sharedComponentFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const d of SHARED_COMPONENT_DIRS) walk(d);
  return out;
}

describe("admin IA — page inventory", () => {
  test("every page that existed at the Batch 2 baseline still exists", () => {
    // Owner ruling 6 + ruling 14: Batch 2 deletes zero pages, and the Phase 1
    // inventory is the regression source of truth. Additions are allowed
    // (Batch 2 adds the /admin root redirect); removals are not.
    assert.equal(BASELINE_ADMIN_ROUTES.length, 139, "the frozen baseline is the 139-page inventory");
    const present = new Set(ROUTES);
    const deleted = BASELINE_ADMIN_ROUTES.filter((r) => !present.has(r));
    assert.deepEqual(deleted, [], `pages deleted since the baseline:\n${deleted.join("\n")}`);
  });

  test("pages added since the baseline are deliberate, not accidental", () => {
    // This guard exists so a new admin page cannot appear unnoticed: every
    // addition must be named here on purpose. Sorted, because ROUTES is.
    //   /admin                            — Batch 2 root redirect.
    //   /admin/dealer-outreach/coverage   — dealer contact-coverage census
    //     (HUB under /admin/dealer-outreach; read-only ops readout).
    //   /admin/dealer-outreach/queue      — prioritized outreach work queue
    //     (RAIL entry under Dealers, beside Dealer Recruitment). It is its own
    //     rail item rather than a hub page because it is a daily working
    //     surface, not a readout: the pipeline page answers "what do we have",
    //     this one answers "who do I contact right now".
    //   /admin/settings/rbac-shadow       — the RBAC shadow-denial report
    //     (HUB under /admin/settings, already linked from its SETTINGS_LINKS).
    //     It is a live operational surface, not scaffolding: permissions.ts runs
    //     in shadow mode with RBAC_ENFORCE unset, writes the RBAC_SHADOW_DENY
    //     rows this page reads, and the documented precondition for the enforce
    //     flip is the owner's review of exactly this report. A HUB rather than a
    //     rail entry because it is read before one configuration decision, not a
    //     daily working surface.
    const baseline = new Set(BASELINE_ADMIN_ROUTES);
    const added = ROUTES.filter((r) => !baseline.has(r));
    assert.deepEqual(
      added,
      [
        "/admin",
        "/admin/dealer-outreach/coverage",
        "/admin/dealer-outreach/queue",
        "/admin/settings/rbac-shadow",
      ],
      "an unlisted admin page appeared — add it here deliberately, with its IA placement",
    );
  });

  test("every page is accounted for in the IA — none orphaned", () => {
    const rail = new Set(railHrefs());
    const unaccounted = ROUTES.filter(
      (r) =>
        !rail.has(r) &&
        !(r in HUB_PARENTS) &&
        !(r in DETAIL_PARENTS) &&
        !(r in LEGACY_REDIRECTS) &&
        !(r in EXTERNAL_ENTRY_ROUTES) &&
        !AUTH_ROUTES.includes(r),
    );
    assert.deepEqual(
      unaccounted,
      [],
      `These pages exist but no navigation path claims them:\n${unaccounted.join("\n")}`,
    );
  });

  test("the IA references no page that does not exist", () => {
    const known = new Set(ROUTES);
    const claimed = [
      ...railHrefs().filter((h) => h.startsWith("/admin")),
      ...Object.keys(HUB_PARENTS),
      ...Object.keys(DETAIL_PARENTS),
      ...Object.keys(LEGACY_REDIRECTS),
      ...Object.keys(EXTERNAL_ENTRY_ROUTES),
      ...AUTH_ROUTES,
    ];
    const phantom = claimed.filter((h) => !known.has(h));
    assert.deepEqual(phantom, [], `IA names routes with no page.tsx:\n${phantom.join("\n")}`);
  });

  test("no page is claimed by two different tiers", () => {
    const seen = new Map<string, string[]>();
    const record = (route: string, tier: string) =>
      seen.set(route, [...(seen.get(route) ?? []), tier]);
    for (const h of railHrefs()) if (h.startsWith("/admin")) record(h, "RAIL");
    for (const h of Object.keys(HUB_PARENTS)) record(h, "HUB");
    for (const h of Object.keys(DETAIL_PARENTS)) record(h, "DETAIL");
    for (const h of Object.keys(LEGACY_REDIRECTS)) record(h, "REDIRECT");
    for (const h of Object.keys(EXTERNAL_ENTRY_ROUTES)) record(h, "EXTERNAL");
    for (const h of AUTH_ROUTES) record(h, "AUTH");
    const dupes = [...seen.entries()].filter(([, tiers]) => tiers.length > 1);
    assert.deepEqual(
      dupes.map(([r, t]) => `${r}: ${t.join(" + ")}`),
      [],
      "a route must occupy exactly one navigation tier",
    );
  });
});

describe("admin IA — every demoted page has a real parent link", () => {
  const shared = sharedComponentFiles();

  for (const [child, parent] of Object.entries({ ...HUB_PARENTS, ...DETAIL_PARENTS })) {
    test(`${parent} links to ${child}`, () => {
      const linked = linkedRoutesIn([...ownedFiles(parent), ...shared]);
      assert.ok(
        linked.has(child),
        `${child} has no rail entry, so ${parent} must link to it — otherwise it is unreachable.`,
      );
    });
  }
});

describe("admin IA — navigation contains no dead links", () => {
  test("every /admin link in admin pages and components resolves to a real page", () => {
    const files = [
      ...ROUTES.flatMap((r) => ownedFiles(r)),
      ...sharedComponentFiles(),
    ];
    const dead: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(LITERAL)) {
        const raw = m[1].split("?")[0].split("#")[0];
        const url = raw.replace(/\$\{[^}]*\}/g, "X").replace(/\/$/, "") || "/admin";
        if (!resolveRoute(url)) {
          dead.push(`${relative(process.cwd(), file)} → ${raw}`);
        }
      }
    }
    assert.deepEqual(dead, [], `links pointing at routes that do not exist:\n${dead.join("\n")}`);
  });
});

describe("admin IA — rail shape", () => {
  test("the landing page is a rail destination", () => {
    assert.ok(railHrefs().includes(ADMIN_LANDING));
  });

  test("no duplicate rail destinations", () => {
    const hrefs = railHrefs();
    assert.equal(new Set(hrefs).size, hrefs.length, "a destination appears twice in the rail");
  });

  test("the rail is materially smaller than the 74 entries Batch 2 inherited", () => {
    assert.ok(
      railHrefs().length < 74,
      `rail still has ${railHrefs().length} entries; consolidation is the point`,
    );
  });

  test("every rail item has a non-empty label and icon", () => {
    for (const section of ALL_SECTIONS) {
      assert.ok(section.label.length > 0);
      assert.ok(section.items.length > 0, `${section.label} renders an empty section header`);
      for (const item of section.items) {
        assert.ok(item.label.trim().length > 0, `${item.href} has no label`);
        assert.ok(item.icon.trim().length > 0, `${item.href} has no icon`);
      }
    }
  });

  test("both report pairs keep both routes and lose only the duplicate rail entry", () => {
    // Owner rulings 3 and 8: consolidate the entry points, redirect neither.
    const rail = new Set(railHrefs());
    for (const pair of [
      ["/admin/reports/affiliate", "/admin/reports/affiliates"],
      ["/admin/reports/funnel", "/admin/reports/buyers"],
    ]) {
      for (const route of pair) {
        assert.ok(ROUTES.includes(route), `${route} must still exist`);
        assert.ok(!rail.has(route), `${route} should no longer hold its own rail entry`);
        assert.equal(HUB_PARENTS[route], "/admin/reports", `${route} must stay reachable`);
        assert.ok(!(route in LEGACY_REDIRECTS), `${route} must not be redirected`);
      }
    }
  });

  test("both request-detail implementations survive (owner ruling 4)", () => {
    assert.ok(ROUTES.includes("/admin/requests/[requestId]"));
    assert.ok(ROUTES.includes("/admin/vehicle-requests/[id]"));
    assert.ok(
      "/admin/vehicle-requests/[id]" in EXTERNAL_ENTRY_ROUTES,
      "the legacy request detail is entered from the new-request admin email",
    );
    assert.equal(HUB_PARENTS["/admin/vehicle-requests"], "/admin/requests");
  });

  test("the orphaned inventory detail page is re-linked (owner ruling 5)", () => {
    assert.equal(DETAIL_PARENTS["/admin/inventory/[id]"], "/admin/inventory");
  });
});

describe("admin IA — pure helpers", () => {
  test("isNavItemActive matches the route and its descendants", () => {
    const item = { href: "/admin/deals" };
    assert.ok(isNavItemActive(item, "/admin/deals"));
    assert.ok(isNavItemActive(item, "/admin/deals/abc123"));
    assert.ok(!isNavItemActive(item, "/admin/dealers"), "prefix must not leak across siblings");
  });

  test("isNavItemActive honours exact matching", () => {
    const item = { href: "/admin/crm", exact: true };
    assert.ok(isNavItemActive(item, "/admin/crm"));
    assert.ok(!isNavItemActive(item, "/admin/crm/inbox"));
  });

  test("isNavItemVisible is permissive when the role is unknown", () => {
    const gated = { label: "x", href: "/x", icon: "i", visibleTo: ["SUPER_ADMIN"] } as const;
    assert.ok(isNavItemVisible(gated, undefined), "an unknown role must not blank the rail");
    assert.ok(isNavItemVisible(gated, "SUPER_ADMIN"));
    assert.ok(!isNavItemVisible(gated, "SUPPORT_ADMIN"));
    assert.ok(isNavItemVisible({ label: "y", href: "/y", icon: "i" }, "SUPPORT_ADMIN"));
  });

  test("sectionForPathname resolves rail, hub and detail pages", () => {
    assert.equal(sectionForPathname("/admin/deals"), "Pipeline");
    assert.equal(sectionForPathname("/admin/reports/funnel"), "Insights");
    assert.equal(sectionForPathname("/admin/inventory/[id]"), "Inventory");
    assert.equal(sectionForPathname("/admin/dashboard"), "Today");
  });

  test("sectionForPathname prefers the most specific rail match", () => {
    // /admin/crm is exact-matched, so a CRM child must resolve via its own entry.
    assert.equal(sectionForPathname("/admin/crm/inbox"), "Engage");
    assert.equal(sectionForPathname("/admin/payments/reconciliation"), "Money");
  });
});

describe("admin IA — external entry points are real", () => {
  for (const [route, sourceFile] of Object.entries(EXTERNAL_ENTRY_ROUTES)) {
    test(`${sourceFile} still links to ${route}`, () => {
      // A route kept alive only for an out-of-console entry point must have
      // that entry point verified, or "it is reachable" is an assumption.
      const src = readFileSync(join(process.cwd(), sourceFile), "utf8");
      const linked = linkedRoutesIn([join(process.cwd(), sourceFile)]);
      assert.ok(
        linked.has(route),
        `${sourceFile} no longer links to ${route}; it is now unreachable.\n` +
          `Searched a file of ${src.length} bytes.`,
      );
    });
  }
});

describe("admin IA — the rail orients on real URLs, not just route patterns", () => {
  // Regression: sectionForPathname originally looked HUB_PARENTS/DETAIL_PARENTS
  // up by literal key. Real pathnames carry concrete ids ("/admin/inventory/abc"),
  // which match no key, so the lookup returned null and the rail rendered fully
  // COLLAPSED on exactly the drill-down pages this batch re-linked.
  const cases: [string, string][] = [
    ["/admin/inventory/abc123", "Inventory"],
    ["/admin/inventory/abc123/edit", "Inventory"],
    ["/admin/inventory/upload/history", "Inventory"],
    ["/admin/vehicle-requests/req_1", "Pipeline"],
    ["/admin/vehicle-requests/req_1/send-to-dealers", "Pipeline"],
    ["/admin/vehicle-offers/off_1", "Pipeline"],
    ["/admin/buyers/buy_1", "Pipeline"],
    ["/admin/deals/deal_1/esign", "Pipeline"],
    ["/admin/crm/contacts/c_1", "Engage"],
    ["/admin/amips/metro/austin-tx", "Inventory"],
    ["/admin/refinance/leads/lead_1", "Growth"],
    ["/admin/dealers/applications/app_1", "Dealers"],
    ["/admin/affiliates/aff_1", "Affiliates"],
    ["/admin/payments/deposits", "Money"],
    ["/admin/compliance/ofac", "Exceptions & Compliance"],
  ];
  for (const [pathname, expected] of cases) {
    test(`${pathname} orients to ${expected}`, () => {
      assert.equal(sectionForPathname(pathname), expected);
    });
  }

  test("an unknown admin path does not throw and yields no section", () => {
    assert.equal(sectionForPathname("/admin/not-a-real-page"), null);
    assert.equal(sectionForPathname("/somewhere/else"), null);
  });

  test("resolution terminates — a parent chain cannot loop forever", () => {
    // Every HUB/DETAIL parent must itself resolve, or the walk would recurse.
    for (const child of [...Object.keys(HUB_PARENTS), ...Object.keys(DETAIL_PARENTS)]) {
      assert.notEqual(sectionForPathname(child), undefined, `${child} did not resolve`);
    }
  });
});

describe("admin IA — every page is reachable by clicking, never by typing a URL", () => {
  // The owner's acceptance question: can an operator reach each surface of a
  // representative workflow without hand-typing a URL? A per-page parent link
  // is necessary but not sufficient — the chain has to actually terminate at a
  // rail entry, or the "parent" is itself unreachable. This walks the transitive
  // closure from the rail outward.
  const rail = new Set(railHrefs().filter((h) => h.startsWith("/admin")));

  function clickPathFrom(route: string): string[] | null {
    const chain: string[] = [route];
    const seen = new Set<string>([route]);
    let cursor = route;
    while (!rail.has(cursor)) {
      const parent: string | undefined = HUB_PARENTS[cursor] ?? DETAIL_PARENTS[cursor];
      if (!parent || seen.has(parent)) return null;
      seen.add(parent);
      chain.unshift(parent);
      cursor = parent;
    }
    return chain;
  }

  test("every non-auth page resolves to a rail entry by following parent links", () => {
    const unreachable: string[] = [];
    for (const route of ROUTES) {
      if (AUTH_ROUTES.includes(route)) continue; // pre-session, entered by redirect
      if (route in EXTERNAL_ENTRY_ROUTES) continue; // asserted separately below
      if (route in LEGACY_REDIRECTS) continue; // a bookmark, redirects to canonical
      if (!clickPathFrom(route)) unreachable.push(route);
    }
    assert.deepEqual(
      unreachable,
      [],
      `these pages cannot be reached by clicking from the sidebar:\n${unreachable.join("\n")}`,
    );
  });

  test("no click path exceeds three steps from the rail", () => {
    const deep: string[] = [];
    for (const route of ROUTES) {
      if (AUTH_ROUTES.includes(route) || route in EXTERNAL_ENTRY_ROUTES) continue;
      if (route in LEGACY_REDIRECTS) continue;
      const chain = clickPathFrom(route);
      if (chain && chain.length > 3) deep.push(`${chain.join(" → ")} (${chain.length})`);
    }
    assert.deepEqual(deep, [], `click paths deeper than rail → hub → detail:\n${deep.join("\n")}`);
  });

  test("the representative workflows are click-complete end to end", () => {
    const WORKFLOWS: Record<string, string[]> = {
      "buyer/request → prequal → auction → deal → completion": [
        "/admin/requests", "/admin/requests/[requestId]", "/admin/prequal", "/admin/prequal/[id]",
        "/admin/buyers", "/admin/buyers/[buyerId]", "/admin/auctions", "/admin/auctions/[auctionId]",
        "/admin/deals", "/admin/deals/[dealId]", "/admin/deals/[dealId]/esign",
        "/admin/deals/[dealId]/pickup",
      ],
      "dealer sourcing → dealer → auction": [
        "/admin/dealer-outreach", "/admin/dealer-outreach/[prospectId]", "/admin/dealers",
        "/admin/dealers/applications", "/admin/dealers/applications/[appId]",
        "/admin/dealers/[dealerId]", "/admin/dealers/health", "/admin/auctions",
      ],
      "payment → reconciliation": [
        "/admin/payments", "/admin/payments/deposits", "/admin/payments/refunds",
        "/admin/payments/reconciliation", "/admin/finance",
      ],
      "affiliate → commission/settlement": [
        "/admin/affiliates", "/admin/affiliates/[affiliateId]", "/admin/affiliates/onboarding",
        "/admin/referral-milestones", "/admin/payments",
      ],
      "exception → affected record → resolution": [
        "/admin/queues", "/admin/manual-reviews", "/admin/financing-reviews",
        "/admin/compliance/ofac", "/admin/operations", "/admin/audit-log",
      ],
      "CRM / communications": [
        "/admin/crm", "/admin/crm/inbox", "/admin/crm/tasks", "/admin/crm/contacts",
        "/admin/crm/contacts/[id]", "/admin/crm/campaigns", "/admin/crm/campaigns/new",
        "/admin/crm/suppression", "/admin/messages", "/admin/messages/[threadId]",
      ],
      "inventory → vehicle detail": [
        "/admin/inventory", "/admin/inventory/[id]", "/admin/inventory/[id]/edit",
        "/admin/inventory/upload", "/admin/inventory/upload/history",
      ],
    };
    const broken: string[] = [];
    for (const [workflow, steps] of Object.entries(WORKFLOWS)) {
      for (const step of steps) {
        assert.ok(ROUTES.includes(step), `${workflow}: ${step} does not exist`);
        if (!clickPathFrom(step)) broken.push(`${workflow}: ${step}`);
      }
    }
    assert.deepEqual(broken, [], `workflow steps requiring a typed URL:\n${broken.join("\n")}`);
  });

  test("the one page not reachable by clicking is documented, and only that one", () => {
    // /admin/vehicle-requests/[id] is entered from the new-request admin email
    // (owner ruling 4). Its list deliberately routes rows to the canonical
    // detail instead, and re-pointing them would change triage routing.
    assert.deepEqual(Object.keys(EXTERNAL_ENTRY_ROUTES), ["/admin/vehicle-requests/[id]"]);
  });
});
