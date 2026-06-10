import type { DomainEventType } from '@/lib/events/emit';

// ---------------------------------------------------------------------------
// MAKE.COM SCENARIO REGISTRY (Step 6 — static, read-only)
// ---------------------------------------------------------------------------
// One entry per Make scenario that listens to an AutoLenis domain event. This
// is a documentation/monitoring surface — it does NOT drive behavior. Update it
// as scenarios are built in Make so the admin monitor stays accurate.

export type ScenarioStatus = 'live' | 'draft' | 'planned' | 'paused';

export interface ScenarioRegistryEntry {
  // Human-readable scenario name as it appears in Make.
  name: string;
  // The AutoLenis domain event that triggers this scenario (via the outbound
  // webhook envelope's `event` field).
  event: DomainEventType;
  status: ScenarioStatus;
  // Short description of what the scenario orchestrates.
  description: string;
  // Deep link into the Make scenario editor (set once the scenario exists).
  makeUrl?: string;
}

export const SCENARIO_REGISTRY: ScenarioRegistryEntry[] = [
  {
    name: 'Buyer Welcome Sequence',
    event: 'buyer_signup',
    status: 'planned',
    description:
      'New buyer onboarding — welcome email + day-2 nudge, dispatched back through /dispatch/email.',
  },
  {
    name: 'Vehicle Request Nurture',
    event: 'vehicle_request_submitted',
    status: 'planned',
    description:
      'Branches on timeline/budget; sends the "request received" touch and schedules follow-ups.',
  },
  {
    name: 'Affiliate Activation',
    event: 'affiliate_signup',
    status: 'planned',
    description: 'Affiliate onboarding + first-share reminder via /dispatch/email.',
  },
  {
    name: 'Dealer Invitation Follow-up',
    event: 'dealer_invited',
    status: 'planned',
    description: 'Reminds an invited dealer to claim their invite before it expires.',
  },
  {
    name: 'Refinance Lead Hand-off',
    event: 'refinance_inquiry',
    status: 'planned',
    description:
      'Qualified refinance leads get a redirect nudge; creates an admin task for unqualified ones.',
  },
];

// Channels surfaced in the live-activity counters on the monitor page.
export const DISPATCH_CHANNELS = ['email', 'sms'] as const;
export type DispatchChannel = (typeof DISPATCH_CHANNELS)[number];
