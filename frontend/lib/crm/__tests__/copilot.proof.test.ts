// Proofs for the CRM Copilot DRAFTING contract. Pure functions only — no Groq
// call — so these run deterministically under tsx --test.
//
// Run with:
//   npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//     --test lib/crm/__tests__/copilot.proof.test.ts
//
// Covers:
//   - Zod proof: malformed model output is REJECTED (never persisted).
//   - Compliance proof: a "guaranteed savings" claim is neutralized, and every
//     SMS draft carries the STOP opt-out.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContentDraftSchema,
  AutomationPlanSchema,
  scrubProhibitedClaims,
  enforceSmsOptOut,
} from '@/lib/ai/crm-copilot';

// ─── Zod proof ───────────────────────────────────────────────────────────────

test('Zod: malformed content output is rejected', () => {
  // Missing `emails`/`sms`, brief wrong type → schema must throw.
  assert.throws(() => ContentDraftSchema.parse({ brief: 123 }));
  // Empty emails array violates min(1).
  assert.throws(() => ContentDraftSchema.parse({ emails: [], sms: [{ body: 'x' }], brief: 'b' }));
});

test('Zod: a valid content draft passes', () => {
  const ok = ContentDraftSchema.parse({
    emails: [{ subject: 'Hi', body: 'Body' }],
    sms: [{ body: 'Hello' }],
    brief: 'A brief',
  });
  assert.equal(ok.emails.length, 1);
});

test('Zod: automation plan rejects a fake trigger and non-integer delay', () => {
  // Trigger not in WorkflowTriggerType.
  assert.throws(() =>
    AutomationPlanSchema.parse({
      triggerEvent: 'not_a_real_trigger',
      audience: 'all buyers',
      steps: [{ channel: 'email', delayHours: 0, templateKey: 't1' }],
    }),
  );
  // delayHours must be an integer.
  assert.throws(() =>
    AutomationPlanSchema.parse({
      triggerEvent: 'deposit_paid',
      audience: 'all buyers',
      steps: [{ channel: 'email', delayHours: 1.5, templateKey: 't1' }],
    }),
  );
  // Bogus channel.
  assert.throws(() =>
    AutomationPlanSchema.parse({
      triggerEvent: 'deposit_paid',
      audience: 'all buyers',
      steps: [{ channel: 'push', delayHours: 0, templateKey: 't1' }],
    }),
  );
});

test('Zod: a valid automation plan passes', () => {
  const ok = AutomationPlanSchema.parse({
    triggerEvent: 'deposit_paid',
    audience: 'Buyers who paid a deposit',
    steps: [
      { channel: 'email', delayHours: 0, templateKey: 'deposit_confirm' },
      { channel: 'sms', delayHours: 24, templateKey: 'nudge_offer' },
    ],
  });
  assert.equal(ok.steps.length, 2);
});

// ─── Compliance proof ────────────────────────────────────────────────────────

test('Compliance: "guaranteed savings" is neutralized — no guarantee claim survives', () => {
  const out = scrubProhibitedClaims('We GUARANTEE you guaranteed savings — a promise you can trust.');
  assert.equal(/guarantee/i.test(out), false);
  assert.equal(/promise/i.test(out), false);
  assert.match(out, /potential savings/i);
});

test('Compliance: every SMS draft carries the STOP opt-out', () => {
  assert.match(enforceSmsOptOut('Your auction starts soon'), /Reply STOP to opt out\.$/);
  // Idempotent — does not double-append when STOP already present.
  const already = 'Deal ends today. Reply STOP to opt out.';
  assert.equal(enforceSmsOptOut(already), already);
});
