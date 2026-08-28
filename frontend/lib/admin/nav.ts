// lib/admin/nav.ts — the AutoLenis admin information architecture, as data.
//
// Batch 2 (admin IA consolidation) moved the navigation tree out of
// components/admin/AdminSidebar.tsx so it can be unit-tested independently of
// React. AdminSidebar renders this; it no longer owns it.
//
// WHY THIS IS DATA, NOT JSX
// The owner-approved acceptance gate for Batch 2 is capability preservation:
// every one of the 139 admin pages that worked before must still be reachable
// after. That is only provable if the IA is inspectable — see
// lib/admin/__tests__/nav-capability-preservation.test.ts, which walks
// app/admin/**/page.tsx on disk and asserts each route is accounted for here.
//
// REACHABILITY TIERS
//   RAIL   — a sidebar entry.
//   HUB    — no sidebar entry; reached from a named parent page that links to it.
//   DETAIL — a drill-down (usually a [param] route); reached from its parent record.
//   REDIRECT — a legacy URL kept alive; the page itself redirects to `canonical`.
//
// Every HUB and DETAIL route names the parent that links to it, and the test
// asserts that link genuinely exists in the source. Nothing is demoted from the
// rail on the assumption that a link exists.

export type AdminRole =
  | "SUPER_ADMIN"
  | "OPERATIONS_ADMIN"
  | "COMPLIANCE_ADMIN"
  | "FINANCE_ADMIN"
  | "SUPPORT_ADMIN";

/** Lucide icon name. AdminSidebar maps these to components; keeping them as
 *  strings is what lets this module be imported by a plain node test. */
export type IconName = string;

export type NavItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** UX-only role filter. Server-side authorization remains authoritative. */
  readonly visibleTo?: readonly AdminRole[];
  readonly badge?: "unread" | "overdue";
  /** Match the href exactly rather than as a path prefix. */
  readonly exact?: boolean;
};

/** The landing page an admin is sent to. Owner ruling 1. */
export const ADMIN_LANDING = "/admin/dashboard";

export type NavSection = {
  readonly label: string;
  readonly items: readonly NavItem[];
};

/** The fixed home area. Pinned above the collapsible sections — per owner
 *  ruling 1, "Today" is the home area, not another operational section. */
export const HOME_SECTION: NavSection = {
  label: "Today",
  items: [
    { label: "Dashboard", href: "/admin/dashboard", icon: "LayoutDashboard" },
    { label: "Ops Dashboard", href: "/admin/ops-dashboard", icon: "Activity" },
    { label: "Notifications", href: "/admin/notifications", icon: "Bell" },
  ],
};

/**
 * The operational sections, in rail order.
 *
 * Section names are derived from the workflows traced in Phase 1 and from the
 * repository's own domain language (request → auction → deal → completion),
 * not from the app/ directory layout.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Pipeline",
    items: [
      { label: "Requests", href: "/admin/requests", icon: "ClipboardList" },
      { label: "Buyers", href: "/admin/buyers", icon: "Users" },
      { label: "Prequalifications", href: "/admin/prequal", icon: "FileCheck" },
      { label: "Auctions", href: "/admin/auctions", icon: "Gavel" },
      { label: "Offers", href: "/admin/offers", icon: "DollarSign" },
      { label: "Deals", href: "/admin/deals", icon: "FileText" },
      { label: "E-Sign", href: "/admin/esign", icon: "PenLine" },
      { label: "Pickups", href: "/admin/pickups", icon: "MapPin" },
      { label: "Documents", href: "/admin/documents", icon: "FolderOpen" },
    ],
  },
  {
    label: "Dealers",
    items: [
      { label: "Dealers", href: "/admin/dealers", icon: "Building2" },
      { label: "Dealer Recruitment", href: "/admin/dealer-outreach", icon: "Phone" },
      { label: "Dealer Health", href: "/admin/dealers/health", icon: "TrendingUp" },
    ],
  },
  {
    label: "Affiliates",
    items: [
      { label: "Affiliates", href: "/admin/affiliates", icon: "Share2" },
      { label: "Onboarding Reviews", href: "/admin/affiliates/onboarding", icon: "ClipboardCheck" },
      { label: "Referral Milestones", href: "/admin/referral-milestones", icon: "Trophy" },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Payment Hub", href: "/admin/payments", icon: "CreditCard" },
      {
        label: "Reconciliation",
        href: "/admin/payments/reconciliation",
        icon: "ClipboardCheck",
        visibleTo: ["SUPER_ADMIN", "FINANCE_ADMIN", "OPERATIONS_ADMIN"],
      },
      {
        label: "Finance",
        href: "/admin/finance",
        icon: "DollarSign",
        visibleTo: ["SUPER_ADMIN", "FINANCE_ADMIN"],
      },
    ],
  },
  {
    label: "Exceptions & Compliance",
    items: [
      { label: "Queues", href: "/admin/queues", icon: "AlertOctagon" },
      { label: "Manual Reviews", href: "/admin/manual-reviews", icon: "ClipboardCheck" },
      { label: "Compliance", href: "/admin/compliance", icon: "Shield" },
      { label: "Contract Shield", href: "/admin/contract-shield", icon: "Shield" },
      { label: "Contracts", href: "/admin/contracts", icon: "ScrollText" },
      { label: "Insurance Requests", href: "/admin/insurance-requests", icon: "Shield" },
      { label: "Pre-Approvals", href: "/admin/external-preapprovals", icon: "FileCheck" },
      // Owner ruling 2: /admin/operations belongs with the exception surfaces,
      // not with platform settings.
      { label: "Operations", href: "/admin/operations", icon: "Activity" },
      { label: "Audit Log", href: "/admin/audit-log", icon: "ScrollText" },
      { label: "Support", href: "/admin/support", icon: "LifeBuoy" },
    ],
  },
  {
    label: "Engage",
    items: [
      { label: "CRM Overview", href: "/admin/crm", icon: "Inbox", exact: true },
      { label: "Inbox", href: "/admin/crm/inbox", icon: "Inbox", badge: "unread" },
      { label: "Tasks", href: "/admin/crm/tasks", icon: "CheckSquare", badge: "overdue" },
      { label: "Contacts", href: "/admin/crm/contacts", icon: "Users" },
      { label: "Leads", href: "/admin/crm/leads", icon: "UserPlus" },
      { label: "Campaigns", href: "/admin/crm/campaigns", icon: "Send" },
      { label: "Templates", href: "/admin/crm/templates", icon: "FileText" },
      { label: "Segments", href: "/admin/crm/segments", icon: "Filter" },
      { label: "Suppression", href: "/admin/crm/suppression", icon: "ShieldOff" },
      { label: "Scenarios", href: "/admin/crm/scenarios", icon: "Workflow" },
      { label: "CRM Analytics", href: "/admin/crm/analytics", icon: "BarChart3" },
      { label: "Coverage", href: "/admin/crm/coverage", icon: "ShieldCheck" },
      { label: "Messages", href: "/admin/messages", icon: "MessageSquare" },
      { label: "Comms", href: "/admin/comms", icon: "Send" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Inventory", href: "/admin/inventory", icon: "Package", exact: true },
      { label: "Search Tool", href: "/admin/inventory/search-tool", icon: "Search" },
      { label: "Markets", href: "/admin/inventory/markets", icon: "Globe" },
      { label: "Demand Gap", href: "/admin/inventory/demand-gap", icon: "TrendingDown" },
      // Owner ruling 2: AMIPS stays with Inventory — it drives sourcing.
      { label: "AMIPS", href: "/admin/amips", icon: "Globe" },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Content Engine", href: "/admin/content", icon: "Newspaper" },
      { label: "Social", href: "/admin/social", icon: "Radio" },
      { label: "Social Intelligence", href: "/admin/social/intelligence", icon: "Brain" },
      { label: "SEO", href: "/admin/seo", icon: "Search" },
      { label: "Buyer Sources", href: "/admin/buyer-sources", icon: "TrendingUp" },
      { label: "Refinance", href: "/admin/refinance", icon: "RefreshCw" },
      { label: "Testimonials", href: "/admin/testimonials", icon: "Star" },
      { label: "Faith Content", href: "/admin/faith-content", icon: "BookOpen" },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports", href: "/admin/reports", icon: "BarChart2", exact: true },
      { label: "Analytics", href: "/admin/analytics", icon: "TrendingUp" },
      { label: "Activity Feed", href: "/admin/activity", icon: "Activity" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Settings", href: "/admin/settings", icon: "Settings", exact: true },
      { label: "Admin Accounts", href: "/admin/settings/admins", icon: "Users" },
      { label: "Security", href: "/admin/security/mfa", icon: "Shield" },
      { label: "System Health", href: "/admin/system-health", icon: "Activity" },
      { label: "AI Console", href: "/admin/ai", icon: "Brain" },
      { label: "Platform Status", href: "/status", icon: "CheckCircle2" },
    ],
  },
];

/** Every section rendered in the rail, home area first. */
export const ALL_SECTIONS: readonly NavSection[] = [HOME_SECTION, ...NAV_SECTIONS];

/** Flat list of every rail destination. */
export function railHrefs(): string[] {
  return ALL_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
}

/**
 * Pages with no rail entry, and the parent page that links to each.
 *
 * The parent is a promise the capability-preservation test enforces: it greps
 * the parent route's own directory for a link to the child. If a link is
 * removed, the test fails rather than the page silently becoming unreachable.
 */
export const HUB_PARENTS: Readonly<Record<string, string>> = {
  // Pipeline — requests
  "/admin/vehicle-requests": "/admin/requests",
  "/admin/requests/analytics": "/admin/requests",
  "/admin/vehicle-offers": "/admin/requests",
  // Pipeline — buyers. Owner ruling 7: Journey demoted, route preserved.
  "/admin/journey": "/admin/buyers",
  // Dealers
  "/admin/dealers/applications": "/admin/dealers",
  "/admin/dealers/invite": "/admin/dealers",
  "/admin/inventory/dealer-discovery": "/admin/inventory",
  // Affiliates
  // Money
  "/admin/payments/deposits": "/admin/payments",
  "/admin/payments/refunds": "/admin/payments",
  // Exceptions & compliance
  "/admin/compliance/ofac": "/admin/compliance",
  "/admin/financing-reviews": "/admin/manual-reviews",
  "/admin/contract-shield/rules": "/admin/contract-shield",
  // Engage
  // Inventory
  "/admin/inventory/new": "/admin/inventory",
  "/admin/inventory/upload": "/admin/inventory",
  "/admin/inventory/coverage-map": "/admin/inventory",
  "/admin/inventory/contributions": "/admin/inventory",
  // Growth
  "/admin/content/bulk": "/admin/content",
  "/admin/content/attribution": "/admin/content",
  "/admin/seo/pages": "/admin/seo",
  "/admin/seo/health": "/admin/seo",
  "/admin/seo/keywords": "/admin/seo",
  "/admin/seo/schema": "/admin/seo",
  "/admin/refinance/leads": "/admin/refinance",
  "/admin/refinance/compliance": "/admin/refinance",
  "/admin/refinance/partner": "/admin/refinance",
  "/admin/faith-content/verses": "/admin/faith-content",
  "/admin/faith-content/messages": "/admin/faith-content",
  "/admin/faith-content/hope": "/admin/faith-content",
  // Insights. Owner ruling 3 + 8: the two report pairs keep BOTH routes and
  // lose only their duplicate rail entries; the index is the canonical parent.
  "/admin/reports/buyers": "/admin/reports",
  "/admin/reports/funnel": "/admin/reports",
  "/admin/reports/affiliates": "/admin/reports",
  "/admin/reports/affiliate": "/admin/reports",
  "/admin/reports/dealers": "/admin/reports",
  "/admin/reports/revenue": "/admin/reports",
  "/admin/reports/pipeline": "/admin/reports",
  "/admin/reports/risk": "/admin/reports",
  // AMIPS
  "/admin/amips/report": "/admin/amips",
};

/**
 * Drill-down pages, and the parent record they hang off.
 *
 * These intentionally have no rail entry — a menu cannot usefully list
 * "a buyer" — but each must be linked from its parent workflow.
 */
export const DETAIL_PARENTS: Readonly<Record<string, string>> = {
  "/admin/buyers/[buyerId]": "/admin/buyers",
  "/admin/dealers/[dealerId]": "/admin/dealers",
  "/admin/dealers/applications/[appId]": "/admin/dealers/applications",
  "/admin/affiliates/[affiliateId]": "/admin/affiliates",
  "/admin/dealer-outreach/[prospectId]": "/admin/dealer-outreach",
  "/admin/auctions/[auctionId]": "/admin/auctions",
  "/admin/deals/[dealId]": "/admin/deals",
  "/admin/deals/[dealId]/esign": "/admin/deals",
  "/admin/deals/[dealId]/pickup": "/admin/deals",
  "/admin/prequal/[id]": "/admin/prequal",
  "/admin/requests/[requestId]": "/admin/requests",
  "/admin/vehicle-requests/[id]/send-to-dealers": "/admin/vehicle-requests/[id]",
  "/admin/vehicle-offers/[id]": "/admin/vehicle-offers",
  "/admin/vehicle-offers/new": "/admin/vehicle-offers",
  "/admin/messages/[threadId]": "/admin/messages",
  "/admin/content/[id]": "/admin/content",
  // Owner ruling 5: re-linked from the canonical inventory list in Batch 2.
  "/admin/inventory/[id]": "/admin/inventory",
  "/admin/inventory/[id]/edit": "/admin/inventory",
  "/admin/inventory/upload/history": "/admin/inventory/upload",
  "/admin/refinance/leads/[leadId]": "/admin/refinance/leads",
  "/admin/amips/metro/[metro]": "/admin/amips",
  "/admin/amips/vehicle/[make]/[model]": "/admin/amips",
  "/admin/crm/contacts/[id]": "/admin/crm/contacts",
  "/admin/crm/campaigns/[id]": "/admin/crm/campaigns",
  "/admin/crm/campaigns/new": "/admin/crm/campaigns",
  "/admin/crm/templates/[id]/edit": "/admin/crm/templates",
  "/admin/crm/templates/new": "/admin/crm/templates",
  "/admin/crm/segments/[id]/edit": "/admin/crm/segments",
  "/admin/crm/segments/new": "/admin/crm/segments",
};

/**
 * Legacy URLs kept alive so existing bookmarks keep working. Each page already
 * redirects to `canonical` — Batch 2 deletes none of them.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  // The console root. Added in Batch 2 — /admin previously 404'd for a
  // signed-in admin because no page.tsx existed and nothing redirected it.
  "/admin": ADMIN_LANDING,
  "/admin/crm/automations": "/admin/crm/scenarios",
  "/admin/crm/automations/new": "/admin/crm/scenarios",
  "/admin/crm/automations/[id]/edit": "/admin/crm/scenarios",
};

/**
 * Routes whose canonical entry point is outside the console, mapped to the
 * source file that proves the entry point exists.
 *
 * Owner ruling 4 — /admin/vehicle-requests/[id] is NOT dead legacy. The admin
 * alert for every new public vehicle request builds its "View Full Request"
 * CTA from a Notification id, and a Notification id never matches a
 * VehicleRequest id, so the page's own redirect does not fire and the operator
 * lands on this implementation every time. It also carries the buyer's email
 * and phone, which the canonical /admin/requests/[requestId] does not render.
 *
 * It is therefore deliberately NOT given a list link: /admin/vehicle-requests
 * routes its rows to the canonical detail on purpose, and re-pointing them
 * would change request-triage routing — a business-workflow change this batch
 * is not permitted to make. The Notification-id/VehicleRequest-id mismatch is
 * recorded as a separate verified defect for a later batch.
 */
export const EXTERNAL_ENTRY_ROUTES: Readonly<Record<string, string>> = {
  "/admin/vehicle-requests/[id]": "lib/services/email/vehicle-offers.email.ts",
};

/**
 * Routes that are reachable but belong to no navigable workflow: the
 * unauthenticated admin auth flow. Listed so the coverage test accounts for
 * every page rather than silently ignoring a directory.
 */
export const AUTH_ROUTES: readonly string[] = [
  "/admin/auth/signin",
  "/admin/auth/setup-mfa",
  "/admin/auth/verify-mfa",
];

/** Active-state matching for a rail entry. */
export function isNavItemActive(item: Pick<NavItem, "href" | "exact">, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** UX-only visibility filter. Never an authorization boundary. */
export function isNavItemVisible(item: NavItem, role?: string): boolean {
  if (!item.visibleTo) return true;
  if (!role) return true;
  return (item.visibleTo as readonly string[]).includes(role);
}

/** Compiled matcher for a route pattern, so "[id]" matches a concrete id. */
function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/^\//, "")
    .split("/")
    .map((s) => (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^/${body}$`);
}

const PARENTS: Readonly<Record<string, string>> = { ...HUB_PARENTS, ...DETAIL_PARENTS };
const PARENT_PATTERNS: { re: RegExp; parent: string }[] = Object.entries(PARENTS)
  .filter(([child]) => child.includes("["))
  .map(([child, parent]) => ({ re: patternToRegExp(child), parent }));

/** The parent of a pathname, matching "[id]" route patterns against real ids. */
function parentOf(pathname: string): string | undefined {
  const exact = PARENTS[pathname];
  if (exact) return exact;
  return PARENT_PATTERNS.find(({ re }) => re.test(pathname))?.parent;
}

/**
 * The section a pathname belongs to, used to auto-expand the rail.
 *
 * Resolution order matters. A real pathname is "/admin/inventory/abc123", not
 * "/admin/inventory/[id]", so a literal map lookup finds nothing — and
 * "/admin/inventory" is an exact-match rail entry, so prefix matching finds
 * nothing either. Without the pattern and ancestor steps below, the rail
 * renders fully collapsed on precisely the drill-down pages this IA re-linked.
 */
export function sectionForPathname(pathname: string): string | null {
  const seen = new Set<string>();
  let current: string | null = pathname;

  while (current && !seen.has(current)) {
    seen.add(current);

    // 1. The most specific rail entry that claims this path.
    let best: { label: string; len: number } | null = null;
    for (const section of ALL_SECTIONS) {
      for (const item of section.items) {
        if (isNavItemActive(item, current) && item.href.length > (best?.len ?? -1)) {
          best = { label: section.label, len: item.href.length };
        }
      }
    }
    if (best) return best.label;

    // 2. A declared hub/detail parent, matched as a route pattern.
    const parent = parentOf(current);
    if (parent) {
      current = parent;
      continue;
    }

    // 3. Otherwise walk up one path segment and try again.
    const cut = current.lastIndexOf("/");
    current = cut > "/admin".length - 1 ? current.slice(0, cut) : null;
  }

  return null;
}
