// Shared test harness for the ActionIntent layer. Not a *.test.ts file, so the
// runner never executes it directly; the suites import from it. Because the
// engine is fully dependency-injected, every test is hermetic — no DB, no
// module mocks, no network.

import { getIntentDefinition, allIntentTypes } from "../catalog";
import { InMemoryActionIntentStore } from "../store";
import type { EngineDeps } from "../engine";
import type {
  ActorContext,
  CommandFn,
  PolicyDeps,
  ActionIntentStatus,
} from "../types";
import type { ActionIntentAuditEvent, ActionIntentAuditRecorder } from "../store";

export function activationKeyFor(intentType: string): string {
  const d = getIntentDefinition(intentType);
  if (!d) throw new Error(`no such intent ${intentType}`);
  return d.activationKey;
}

export function makeActor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    actorType: "BUYER",
    actorId: "buyer-1",
    authenticatedRole: "BUYER",
    ...overrides,
  };
}

// Policy deps that ALLOW every intent (happy authoritative state). Individual
// tests override a single getter to force a denial.
export function permissivePolicyDeps(overrides: Partial<PolicyDeps> = {}): PolicyDeps {
  return {
    isFulfillmentUnlocked: async () => true,
    getOfferContext: async () => ({
      auctionId: "auction-1",
      auctionBuyerId: "buyer-1",
      auctionStatus: "ACTIVE",
      offerStatus: "SUBMITTED",
    }),
    getDealContext: async () => ({ buyerId: "buyer-1", status: "ACTIVE" }),
    getAuctionContext: async () => ({ buyerId: "buyer-1", status: "ACTIVE" }),
    getDepositContext: async () => ({ buyerId: "buyer-1", status: "PAID" }),
    getDealerInvited: async () => true,
    ...overrides,
  };
}

export interface RecordingCommands {
  commands: Record<string, CommandFn>;
  calls: string[];
}

// A command registry whose commands record their invocation and return a fixed
// authoritative result. `calls` is the side-effect proxy: if an intent was
// rejected, its command must NEVER appear here.
export function recordingCommands(
  result: (intentType: string) => { ok: boolean; data?: Record<string, unknown>; failureReason?: string } = () => ({
    ok: true,
    data: { executed: true },
  }),
): RecordingCommands {
  const calls: string[] = [];
  const commands: Record<string, CommandFn> = {};
  for (const type of allIntentTypes()) {
    commands[type] = async () => {
      calls.push(type);
      return result(type);
    };
  }
  return { commands, calls };
}

export interface CapturingAudit extends ActionIntentAuditRecorder {
  events: ActionIntentAuditEvent[];
  statuses(): ActionIntentStatus[];
}

export function capturingAudit(): CapturingAudit {
  const events: ActionIntentAuditEvent[] = [];
  return {
    events,
    statuses: () => events.map((e) => e.status),
    async record(e) {
      events.push(e);
    },
  };
}

export interface TestDeps extends EngineDeps {
  audit: CapturingAudit;
  calls: string[];
}

// Build engine deps. `active` is the set of activation keys to enable (default:
// none → dormant/fail-closed). Pass intent types; they are resolved to keys.
export function makeDeps(opts: {
  activeIntents?: string[];
  policyDeps?: PolicyDeps;
  commandResult?: (intentType: string) => { ok: boolean; data?: Record<string, unknown>; failureReason?: string };
} = {}): TestDeps {
  const active = new Set((opts.activeIntents ?? []).map(activationKeyFor));
  const rec = recordingCommands(opts.commandResult);
  const audit = capturingAudit();
  let counter = 0;
  return {
    store: new InMemoryActionIntentStore(),
    audit,
    activation: async (key: string) => active.has(key),
    policyDeps: opts.policyDeps ?? permissivePolicyDeps(),
    commands: rec.commands,
    genId: () => `id-${++counter}`,
    calls: rec.calls,
  };
}
