// lib/services/financing/lender/mock-lender-adapter.ts
// A SCRIPTED test double for the lender adapter. It contains NO credit-decisioning
// logic — it echoes the scenario it was constructed with. This lets the whole
// engine be built and tested without a real lender or real credit data. Its
// default (no scenario) is PENDING, which routes to human review — never a silent
// approve/decline — so an accidental production use fails safe.

import type { LenderAdapter, CreditApplicationSubmission, LenderResult, LenderDecision } from "./types";

export interface MockLenderOptions {
  configured?: boolean;
  scenario?: LenderDecision;
  throwOnSubmit?: Error;
  /** When set, submit() awaits this promise before resolving (to exercise timeouts). */
  hangUntil?: Promise<void>;
}

export class MockLenderAdapter implements LenderAdapter {
  readonly name = "mock";
  submitCallCount = 0;

  constructor(private readonly opts: MockLenderOptions = {}) {}

  isConfigured(): boolean {
    return this.opts.configured ?? true;
  }

  async submit(app: CreditApplicationSubmission): Promise<LenderResult> {
    this.submitCallCount += 1;
    void app;
    if (this.opts.throwOnSubmit) throw this.opts.throwOnSubmit;
    if (this.opts.hangUntil) await this.opts.hangUntil;
    return { ok: true, decision: this.opts.scenario ?? { outcome: "PENDING" } };
  }

  async getStatus(lenderReferenceId: string): Promise<LenderResult> {
    void lenderReferenceId;
    return { ok: true, decision: this.opts.scenario ?? { outcome: "PENDING" } };
  }
}
