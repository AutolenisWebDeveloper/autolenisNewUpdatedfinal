// BUILD-FAILING RULE — §35, the governing scope constraint.
//
//   "This document authorizes no parallel website, no replacement architecture,
//    and no unrelated code changes."
//
// §11.5 ruling 10: "Phase 2 gate, Phase 11 acceptance." Landing a new gate in
// Phase 1 would itself be a Phase-1 capability, which constraint C1 forbids, so the
// scope check lives here and is re-asserted as an acceptance item in Phase 11.
//
// WHY A MANIFEST AND NOT A DIFF. The obvious implementation is
// `git diff <base>...HEAD`, and it does not work here: no test in this repository
// shells out to git, and none of the five `actions/checkout` steps in
// `.github/workflows/ci.yml` sets `fetch-depth`, so a base commit is not in the
// clone. A guard that silently degrades to "no diff available, pass" on CI would
// be worse than none. So the shape of the tree is captured as a committed BASELINE
// and each phase DECLARES what it may add. The manifest is the reviewable artefact;
// the walk is what makes it true.
//
// WHAT IT CATCHES. A new route family under `app/api`, a new service directory
// under `lib/services`, a new top-level `lib/` directory, or a new table — any of
// which is how "a parallel website" or "a replacement architecture" would actually
// show up in a diff — unless the current phase declared it. Plus a second Next.js
// app root, a new file in the frozen legacy trees, and any change to the two
// automation flags §35's row names.
//
// THE GUARD DECLARES ITS OWN PHASE'S ADDITIONS. Phase 2 adds
// `lib/services/operations/` (the exception writer) and `lib/services/transaction/`
// (the §30 responsibility registry). Both are named below. A guard that failed on
// its own phase's deliverables would be uninstallable, and one that exempted
// itself silently would be pointless.
//
// Run: pnpm test:security

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { read } from "@/lib/testing/source-scan";

const APP_ROOT = process.cwd();
/** The repository root — one level above `frontend/`. §35 is about the whole repo. */
const REPO_ROOT = resolve(APP_ROOT, "..");

/** The phase this branch implements. */
const CURRENT_PHASE = 4;

/** What each phase is allowed to ADD, beyond the baseline. §8.2 declares these. */
const PHASE_SCOPE: Record<number, { routeFamilies: string[]; serviceDirs: string[]; libDirs: string[]; tables: string[] }> = {
  2: {
    routeFamilies: [],
    // `operations` — the single §26 exception writer (§8.2 Phase 2 Part A).
    // `transaction` — the §30 stage-responsibility registry (§11.5 ruling 11).
    serviceDirs: ["operations", "transaction"],
    libDirs: [],
    // Phase 2 adds no table: constraint C1 allows exactly one schema wave and it
    // was Phase 1's.
    tables: [],
  },
  3: {
    routeFamilies: [],
    // `sourcing` — the sourcing case §5d's settlement side effect opens
    // (S6-02a/S6-29a). The `sourcing_cases` table has existed since the Phase 1 wave
    // with nothing writing it; this is the writer. It is a new directory rather than a
    // home inside `payment/` because Phase 5 builds the ladder, the band expansion and
    // the readiness checklist on top of this record, and they are sourcing, not payment.
    serviceDirs: [
      "sourcing",
      // `plan` — §23.2's upgrade window and the $499-less-$99 quote, computed from the
      // ledger of settled payments rather than from the `buyers.plan` flag. A directory
      // rather than a home inside `payment/` because §23 is a product model — election
      // versus entitlement, the window, downgrade and re-upgrade — that Phase 8's
      // clearance close and Phase 10's cancellation both read. The parity ledger names
      // `lib/services/plan/__tests__/upgrade-window.test.ts` for exactly this.
      "plan",
    ],
    libDirs: [],
    // Phase 3 adds no TABLE. Its one migration adds an enum LABEL —
    // `DepositStatus.DISPUTED` (control/E26-10) — which this guard does not track and
    // should not: constraint C1 bounds the additive COLUMN wave, and §12.2 provides for
    // "any schema-touching phase".
    tables: [],
  },
  4: {
    // DELIBERATELY EMPTY, ALL FOUR KEYS. Phase 4 is 90 parity rows across nine areas
    // and adds no new directory and no new table — every one of its files lands in a
    // directory that already exists:
    //
    //   qualified-results.service.ts, listing-rooftop-resolution changes → lib/services/inventory
    //   co-buyer capture                                                 → lib/services/vehicle-request
    //   trade packet + edit path                                         → lib/services/trade-in
    //   the single gated shortlist writer                                → lib/services/shortlist
    //   candidate creation and revalidation                              → lib/services/auction
    //   every new route                                                  → app/api/buyer (an existing family)
    //
    // and its one migration (`20261112000000_stage4_trade_election`) adds a COLUMN,
    // `vehicle_requests.trade_elected`, not a table. The `inventory_query_cache` table
    // Phase 4's cache reads already exists — the Phase 1 wave created it
    // (20261106000100/migration.sql), so it is in BASELINE_TABLES and is not this
    // phase's to declare.
    //
    // The entry exists rather than being absent so the record is a statement rather
    // than an omission: `allowed()` loops p = 2 … CURRENT_PHASE and treats a missing
    // key identically to an empty one, which means "Phase 4 declared nothing" and
    // "nobody wrote a Phase 4 entry" would be indistinguishable. They are not the same
    // claim, and this file is where the difference is recorded.
    routeFamilies: [],
    serviceDirs: [],
    libDirs: [],
    tables: [],
  },
};

function dirsIn(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((e) => statSync(join(path, e)).isDirectory())
    .sort();
}

function declaredTablesInSchema(): string[] {
  const schema = read(APP_ROOT, "prisma/schema.prisma");
  return [...schema.matchAll(/@@map\("([a-z0-9_]+)"\)/g)].map((m) => m[1]!).sort();
}

function allowed(baseline: readonly string[], key: "routeFamilies" | "serviceDirs" | "libDirs" | "tables"): Set<string> {
  const set = new Set(baseline);
  for (let p = 2; p <= CURRENT_PHASE; p++) {
    for (const item of PHASE_SCOPE[p]?.[key] ?? []) set.add(item);
  }
  return set;
}

const BASELINE_TABLES: readonly string[] = [
  "ab_test_groups",
  "ab_test_variants",
  "accepted_terms",
  "acquisition_conversations",
  "admin_audit_logs",
  "admin_briefing_history",
  "admin_briefings",
  "admin_impersonations",
  "admin_inventory_search_runs",
  "admin_journey_notes",
  "admin_journey_unlocks",
  "admin_login_logs",
  "admin_mfa_email_tokens",
  "admin_sessions",
  "admin_support_notes",
  "admins",
  "affiliate_clicks",
  "affiliate_compliance_records",
  "affiliate_documents",
  "affiliate_onboarding_reviews",
  "affiliate_payment_profiles",
  "affiliate_payout_methods",
  "affiliate_payout_schedules",
  "affiliate_payouts",
  "affiliate_profiles",
  "affiliate_referrals",
  "affiliate_tax_profiles",
  "affiliate_tier_history",
  "affiliates",
  "ai_action_intents",
  "ai_chat_messages",
  "ai_chat_sessions",
  "ai_context_cache",
  "ai_conversation_contexts",
  "ai_kill_switch_logs",
  "ai_media_generations",
  "amips_intelligence_snapshots",
  "amips_market_scores",
  "amips_pages",
  "analytics_cohorts",
  "apollo_credit_ledger",
  "apollo_enrichment_runs",
  "apollo_person_candidates",
  "apollo_reveals",
  "auction_extension_logs",
  "auction_invitations",
  "auction_vehicles",
  "auctions",
  "audit_logs",
  "autolenis_intelligence",
  "best_price_calculation_logs",
  "best_price_weight_configs",
  "best_price_weight_history",
  "buyer_activity_events",
  "buyer_credit_history",
  "buyer_inventory_preferences",
  "buyer_nudge_preferences",
  "buyer_offer_review_items",
  "buyer_offer_reviews",
  "buyer_opportunities",
  "buyer_preferences",
  "buyer_request_claim_tokens",
  "buyers",
  "circumvention_attempts",
  "co_buyers",
  "commissions",
  "comms_outbox",
  "competitor_insights",
  "compliance_events",
  "compliance_rules",
  "content_article_versions",
  "content_articles",
  "content_attributions",
  "content_derivatives",
  "content_franchises",
  "content_generation_job_items",
  "content_generation_jobs",
  "content_media_assets",
  "content_queue",
  "content_validation_results",
  "content_workflow_events",
  "contract_scan_history",
  "contract_scan_rule_history",
  "contract_scan_rules",
  "contract_scans",
  "contract_versions",
  "creator_attributions",
  "creator_network",
  "credit_applications",
  "cron_job_logs",
  "csrf_tokens",
  "deal_corrections",
  "deal_notes",
  "deal_recaps",
  "deal_status_history",
  "deal_timeline",
  "dealer_account_claim_tokens",
  "dealer_agreement_signatures",
  "dealer_applications",
  "dealer_availability",
  "dealer_availability_windows",
  "dealer_blackout_dates",
  "dealer_capacity_configs",
  "dealer_contact_profiles",
  "dealer_discoveries",
  "dealer_feed_configs",
  "dealer_intelligence",
  "dealer_invitations",
  "dealer_licenses",
  "dealer_offer_submissions",
  "dealer_outreach_log",
  "dealer_payments",
  "dealer_prospects",
  "dealer_reaffirmations",
  "dealer_rooftops",
  "dealer_scorecard_snapshots",
  "dealer_scorecard_weights",
  "dealer_verifications",
  "dealers",
  "deals",
  "deposits",
  "document_requests",
  "document_versions",
  "documents",
  "e_sign_envelope_history",
  "e_sign_envelopes",
  "email_send_logs",
  "encouragement_messages",
  "external_pre_approval_documents",
  "external_pre_approvals",
  "faith_content_audit_logs",
  "feature_flags",
  "financing",
  "financing_audit_events",
  "financing_review_tasks",
  "financing_scenarios",
  "funnel_stage_snapshots",
  "health_check_logs",
  "hook_performance",
  "hope_page_content",
  "idempotency_keys",
  "identity_firewall_entries",
  "insurance_policies",
  "insurance_providers",
  "insurance_quotes",
  "inventory_feed_logs",
  "inventory_items",
  "inventory_price_alerts",
  "inventory_quality_scores",
  "inventory_query_cache",
  "inventory_sources",
  "inventory_sync_runs",
  "inventory_upload_batches",
  "jobs_dead_letter",
  "junk_fee_patterns",
  "lead_scores",
  "lifecycle_touch_schedule",
  "market_coverage",
  "market_intelligence",
  "marketplace_intelligence",
  "message_read_receipts",
  "message_thread_participants",
  "message_threads",
  "messages",
  "notification_batches",
  "notification_preferences",
  "notifications",
  "nudge_configurations",
  "nudge_events",
  "offers",
  "outside_auction_invites",
  "payment_provider_events",
  "pickups",
  "plan_snapshots",
  "platform_alerts",
  "platform_stat_snapshots",
  "post_completion_obligations",
  "posting_windows",
  "pre_qualifications",
  "prequal_consents",
  "queue_items",
  "rate_limit_events",
  "referral_milestone_configs",
  "referral_milestones",
  "refinance_applications",
  "refinance_compliance_logs",
  "revenue_attributions",
  "revenue_snapshots",
  "saved_searches",
  "search_cache",
  "search_filters",
  "search_intelligence",
  "seo_health_scores",
  "seo_keywords",
  "seo_page_configs",
  "seo_redirects",
  "seo_sitemap_entries",
  "service_fee_payments",
  "sessions",
  "shortlist_items",
  "shortlists",
  "sla_violations",
  "sms_opt_outs",
  "social_intelligence_cache",
  "social_leads",
  "social_performance",
  "social_posts",
  "social_videos",
  "sourcing_candidates",
  "sourcing_cases",
  "system_config_history",
  "system_configurations",
  "testimonials",
  "topic_signals",
  "trade_in_submissions",
  "trade_in_valuations",
  "user_preferences",
  "users",
  "vehicle_comparisons_saved",
  "vehicle_intelligence",
  "vehicle_match_scores",
  "vehicle_offer_dealer_invites",
  "vehicle_offers",
  "vehicle_request_buyer_updates",
  "vehicle_request_due_diligence_checkpoints",
  "vehicle_request_events",
  "vehicle_request_financing",
  "vehicle_request_match_results",
  "vehicle_request_offers",
  "vehicle_request_research_logs",
  "vehicle_requests",
  "verse_library",
  "verse_page_assignments",
  "violation_pattern_records",
  "webhook_events",
  "winning_patterns",
];

/** The tree as it stood at the end of Phase 1. Additions are declared, never assumed. */
const BASELINE = {
  routeFamilies: [
    "admin",
    "affiliate",
    "auth",
    "buyer",
    "concierge",
    "crm",
    "cron",
    "dealer",
    "faith",
    "finder",
    "internal",
    "jobs",
    "leads",
    "public",
    "tools",
    "twilio",
    "webhooks",
  ],
  serviceDirs: [
    "__tests__",
    "acquisition",
    "activity",
    "admin",
    "affiliate",
    "agreement",
    "ai",
    "analytics",
    "auction",
    "audit",
    "auth",
    "buyer",
    "campaign",
    "comms",
    "concierge",
    "content",
    "contract",
    "contract-shield",
    "crm",
    "deal",
    "dealer",
    "dealer-recruitment",
    "documents",
    "email",
    "esign",
    "faith",
    "financing",
    "ghl",
    "identity",
    "integrations",
    "inventory",
    "messaging",
    "monitoring",
    "notifications",
    "nudge",
    "offer",
    "payment",
    "pickup",
    "prequal",
    "referral",
    "refinance",
    "search",
    "seo",
    "shortlist",
    "sms",
    "system",
    "trade-in",
    "trust",
    "vehicle-request",
    "voice",
    "webhooks",
  ],
  libDirs: [
    "__tests__",
    "admin",
    "affiliate",
    "ai",
    "amips",
    "analytics",
    "api",
    "auth",
    "constants",
    "content",
    "crm",
    "design",
    "domain",
    "events",
    "hooks",
    "jobs",
    "leads",
    "observability",
    "payments",
    "qstash",
    "security",
    "seo",
    "services",
    "social",
    "testing",
    "tools",
    "types",
    "util",
    "utils",
    "voice",
  ],
} as const;

test("no new route family under app/api outside the phase's declared scope", () => {
  const actual = dirsIn(join(APP_ROOT, "app/api"));
  const permitted = allowed(BASELINE.routeFamilies, "routeFamilies");
  const added = actual.filter((d) => !permitted.has(d));
  assert.deepEqual(
    added,
    [],
    "§35 authorizes no parallel website and no replacement architecture. A new API route family is how " +
      "either would appear. If this phase genuinely needs one, declare it in PHASE_SCOPE with the §8.2 " +
      `bullet that authorises it. Undeclared: ${added.join(", ")}`
  );
});

test("no new service directory under lib/services outside the phase's declared scope", () => {
  const actual = dirsIn(join(APP_ROOT, "lib/services"));
  const permitted = allowed(BASELINE.serviceDirs, "serviceDirs");
  const added = actual.filter((d) => !permitted.has(d));
  assert.deepEqual(added, [], `Undeclared service directory: ${added.join(", ")}. Declare it in PHASE_SCOPE or reuse an existing one.`);
});

test("no new top-level lib/ directory outside the phase's declared scope", () => {
  const actual = dirsIn(join(APP_ROOT, "lib"));
  const permitted = allowed(BASELINE.libDirs, "libDirs");
  const added = actual.filter((d) => !permitted.has(d));
  assert.deepEqual(added, [], `Undeclared lib directory: ${added.join(", ")}`);
});

test("no new table outside the phase's declared scope", () => {
  const actual = declaredTablesInSchema();
  const permitted = allowed(BASELINE_TABLES, "tables");
  const added = actual.filter((t) => !permitted.has(t));
  assert.deepEqual(
    added,
    [],
    "Constraint C1 allows exactly ONE schema wave, and it was Phase 1's. A new table here is a second " +
      `wave. Undeclared: ${added.join(", ")}`
  );
});

test("exactly one Next.js app root — no parallel website", () => {
  const configs = readdirSync(REPO_ROOT)
    .filter((e) => /^next\.config\./.test(e))
    .concat(existsSync(join(REPO_ROOT, "frontend")) ? readdirSync(join(REPO_ROOT, "frontend")).filter((e) => /^next\.config\./.test(e)).map((e) => `frontend/${e}`) : []);
  assert.equal(
    configs.length,
    1,
    `§35: one website. Found ${configs.length} Next.js configs: ${configs.join(", ")}`
  );
  assert.match(configs[0]!, /^frontend\//, "the one app root is frontend/");
});

test("the frozen legacy trees gain no new files", () => {
  // A second HTTP surface already exists and is invisible to CI: backend/server.py
  // is an Emergent preview-ingress dependency. §35 freezes it — it may not GROW —
  // and its retirement is an owner decision, not this phase's.
  // Measured at Phase 2, not estimated: backend/ holds server.py, requirements.txt
  // and 18 pytest files; automation/ 3; root tests/ 4. The number is the ceiling.
  const FROZEN: Record<string, number> = { backend: 20, automation: 3, tests: 4 };
  for (const [dir, maxFiles] of Object.entries(FROZEN)) {
    const full = join(REPO_ROOT, dir);
    if (!existsSync(full)) continue;
    let count = 0;
    const walk = (d: string): void => {
      for (const e of readdirSync(d)) {
        if (e === "node_modules" || e === "__pycache__" || e === ".git") continue;
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else count++;
      }
    };
    walk(full);
    assert.ok(
      count <= maxFiles,
      `${dir}/ is frozen legacy under §35 and grew to ${count} files (was ${maxFiles}). ` +
        "It may not gain new files; its retirement is an owner decision."
    );
  }
});

test("the two automation flags §35's row names are untouched by the transaction phases", () => {
  // §35's parity row (control/G35-01) names ENABLE_AUTO_PUBLISH and
  // SOCIAL_AUTOMATION_MODE specifically: a transaction phase that flipped social
  // automation on would be exactly the "unrelated code change" §35 forbids.
  const config = read(APP_ROOT, "lib/social/config.ts");
  assert.match(config, /ENABLE_AUTO_PUBLISH/, "the flag must still be read from config, not scattered");
  assert.match(config, /SOCIAL_AUTOMATION_MODE/);

  // And nothing outside the social tree may read either one.
  const OUTSIDE = ["app", "lib/services", "components"];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === "__tests__") continue;
      const f = join(dir, e);
      if (statSync(f).isDirectory()) {
        walk(f);
        continue;
      }
      if (!/\.tsx?$/.test(e)) continue;
      const src = read(APP_ROOT, f.slice(APP_ROOT.length + 1));
      if (/ENABLE_AUTO_PUBLISH|SOCIAL_AUTOMATION_MODE/.test(src)) offenders.push(f.slice(APP_ROOT.length + 1));
    }
  };
  for (const root of OUTSIDE) walk(join(APP_ROOT, root));
  // The social tree, by purpose rather than by path prefix alone: the config that
  // owns both flags, the two runtime consumers that promote a SocialPost, and the
  // admin settings surface that displays them. Nothing in the transaction trees.
  const SOCIAL_TREE = [
    "lib/social/",
    "app/admin/social/",
    "app/api/cron/social-",
    "app/api/webhooks/higgsfield",
  ];
  const unexpected = offenders.filter((f) => !SOCIAL_TREE.some((p) => f.startsWith(p)));
  assert.deepEqual(
    unexpected,
    [],
    `§35: a transaction phase must not touch social automation. Readers outside the social tree: ${unexpected.join(", ")}`
  );
});
