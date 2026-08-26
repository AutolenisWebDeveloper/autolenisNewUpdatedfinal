import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowTriggerType,
} from '@/lib/types/crm';

// Prebuilt workflow templates. Each template is a self-contained graph that
// the admin can "Use" — the service clones it into a draft workflow that the
// admin then customizes and activates.
//
// IMPORTANT: action.sendEmail nodes reference template names rather than UUIDs
// (the admin's email_templates table holds UUIDs that vary per environment).
// When the clone API installs a prebuilt workflow, it leaves template_id blank
// and writes the placeholder `template_slug` into config — the builder UI then
// nudges the admin to pick the actual template before activation.

export interface PrebuiltWorkflow {
  key: string;
  category: 'buyer' | 'dealer' | 'affiliate' | 'refinance';
  name: string;
  description: string;
  trigger_type: WorkflowTriggerType;
  graph: WorkflowGraph;
}

// Lightweight node builders keep the prebuilt definitions readable. Positions
// are auto-laid-out vertically; the builder UI can re-layout on import.
let _idCounter = 0;
function nid(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${_idCounter}`;
}

function trigger(triggerType: WorkflowTriggerType): WorkflowNode {
  return { id: nid('trigger'), type: 'trigger', config: { trigger_type: triggerType } };
}
function email(slug: string): WorkflowNode {
  return { id: nid('email'), type: 'action.sendEmail', config: { template_slug: slug, email_type: 'transactional' } };
}
function sms(body: string): WorkflowNode {
  return { id: nid('sms'), type: 'action.sendSms', config: { body } };
}
function delay(duration: string): WorkflowNode {
  return { id: nid('delay'), type: 'delay', config: { duration } };
}
function task(title: string, dueInHours = 24, priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium'): WorkflowNode {
  return { id: nid('task'), type: 'action.createTask', config: { title, due_in_hours: dueInHours, priority } };
}
function updateStage(stage: string): WorkflowNode {
  return { id: nid('stage'), type: 'action.updateStage', config: { stage } };
}
function notify(subject: string, message: string): WorkflowNode {
  return { id: nid('notify'), type: 'action.notifyAdmin', config: { subject, message } };
}
function endNode(): WorkflowNode {
  return { id: nid('end'), type: 'action.endWorkflow', config: {} };
}

// Chain a linear list of nodes into a graph (entry → n1 → n2 → ... → end).
// Layout: stack nodes vertically with even spacing.
function linear(nodes: WorkflowNode[]): WorkflowGraph {
  const positioned = nodes.map((n, idx) => ({
    ...n,
    position: { x: 280, y: 80 + idx * 120 },
  }));
  const edges = positioned.slice(0, -1).map((n, idx) => ({
    from: n.id,
    to: positioned[idx + 1].id,
  }));
  return { nodes: positioned, edges };
}

function build(fn: () => WorkflowGraph): WorkflowGraph {
  _idCounter = 0;
  return fn();
}

// ---------------------------------------------------------------------------
// BUYER (10)
// ---------------------------------------------------------------------------

const buyerWelcome: PrebuiltWorkflow = {
  key: 'buyer_welcome',
  category: 'buyer',
  name: 'Buyer Welcome Sequence',
  description: 'Welcome new buyers — D0 email, D1 SMS check-in, D3 checklist email.',
  trigger_type: 'buyer_signup',
  graph: build(() => linear([
    trigger('buyer_signup'),
    email('buyer_welcome_email'),
    delay('1d'),
    sms('Hi {{firstName}}, welcome to AutoLenis. Reply HELP if you need anything.'),
    delay('3d'),
    email('buyer_checklist_email'),
    endNode(),
  ])),
};

const vehicleRequest: PrebuiltWorkflow = {
  key: 'vehicle_request',
  category: 'buyer',
  name: 'Vehicle Request Confirmation',
  description: 'Confirm vehicle request, notify ops admin, schedule prequal follow-up.',
  trigger_type: 'vehicle_request_submitted',
  graph: build(() => linear([
    trigger('vehicle_request_submitted'),
    email('vehicle_request_confirmation'),
    task('Review vehicle request and prepare dealer auction', 4, 'high'),
    notify('New vehicle request', 'A new vehicle request was submitted by {{fullName}} — review in the admin dashboard.'),
    endNode(),
  ])),
};

const depositReminder: PrebuiltWorkflow = {
  key: 'deposit_reminder',
  category: 'buyer',
  name: 'Deposit Reminder',
  description: 'Nudge unpaid deposit at 1h → 24h → 72h with SMS + email.',
  trigger_type: 'deposit_pending',
  graph: build(() => linear([
    trigger('deposit_pending'),
    delay('1h'),
    sms('{{firstName}}, your AutoLenis deposit link is still waiting. Tap to complete: {{depositUrl}}'),
    delay('23h'),
    email('deposit_reminder_email'),
    delay('2d'),
    email('deposit_final_reminder_email'),
    endNode(),
  ])),
};

const auctionLaunch: PrebuiltWorkflow = {
  key: 'auction_launch',
  category: 'buyer',
  name: 'Auction Launch',
  description: 'Notify buyer that auction has started, set a 48h ops timer.',
  trigger_type: 'deposit_paid',
  graph: build(() => linear([
    trigger('deposit_paid'),
    updateStage('auction_active'),
    email('auction_launch_email'),
    sms('{{firstName}}, your auction is live. Dealers are now competing for your vehicle.'),
    task('Review auction progress for {{fullName}}', 48, 'medium'),
    endNode(),
  ])),
};

const offerReminder: PrebuiltWorkflow = {
  key: 'offer_reminder',
  category: 'buyer',
  name: 'Offer Reminder',
  description: 'Nudge buyer to review offers at 24h, escalate at 48h.',
  trigger_type: 'offer_received',
  graph: build(() => linear([
    trigger('offer_received'),
    email('offer_received_email'),
    delay('1d'),
    sms('{{firstName}}, you have offers waiting. Review here: {{offerUrl}}'),
    delay('1d'),
    notify('Offer not selected', '{{fullName}} has not selected an offer in 48h.'),
    endNode(),
  ])),
};

const financingFollowup: PrebuiltWorkflow = {
  key: 'financing_followup',
  category: 'buyer',
  name: 'Financing Follow-up',
  description: 'Send financing info after offer selected.',
  trigger_type: 'offer_selected',
  graph: build(() => linear([
    trigger('offer_selected'),
    delay('10m'),
    email('financing_info_email'),
    endNode(),
  ])),
};

const contractReminder: PrebuiltWorkflow = {
  key: 'contract_reminder',
  category: 'buyer',
  name: 'Contract Reminder',
  description: 'Nudge unsigned contract at 24h and 48h.',
  trigger_type: 'offer_selected',
  graph: build(() => linear([
    trigger('offer_selected'),
    delay('1d'),
    email('contract_reminder_email'),
    delay('1d'),
    sms('{{firstName}}, your AutoLenis contract is waiting for your signature.'),
    endNode(),
  ])),
};

const pickupPrep: PrebuiltWorkflow = {
  key: 'pickup_prep',
  category: 'buyer',
  name: 'Pickup Preparation',
  description: 'Pickup checklist, directions, and confirmation after signing.',
  trigger_type: 'contract_signed',
  graph: build(() => linear([
    trigger('contract_signed'),
    email('pickup_checklist_email'),
    delay('1d'),
    sms('{{firstName}}, your pickup details are ready. Check your email for the full checklist.'),
    endNode(),
  ])),
};

const postPurchase: PrebuiltWorkflow = {
  key: 'post_purchase',
  category: 'buyer',
  name: 'Post-Purchase Sequence',
  description: 'Thank-you email, 7-day review request, 6-month refi offer.',
  trigger_type: 'purchase_completed',
  graph: build(() => linear([
    trigger('purchase_completed'),
    updateStage('purchase_completed'),
    email('purchase_thankyou_email'),
    delay('7d'),
    email('purchase_review_request_email'),
    delay('180d'),
    email('refi_offer_email'),
    endNode(),
  ])),
};

const inactiveRecovery: PrebuiltWorkflow = {
  key: 'inactive_recovery',
  category: 'buyer',
  name: 'Inactive Recovery (72h)',
  description: '3-touch reactivation for buyers idle for 72h in early stages.',
  trigger_type: 'buyer_inactive',
  graph: build(() => linear([
    trigger('buyer_inactive'),
    email('inactive_touch_1_email'),
    delay('2d'),
    sms('{{firstName}}, still interested in your AutoLenis search? Reply YES to keep going.'),
    delay('3d'),
    email('inactive_final_touch_email'),
    endNode(),
  ])),
};

// ---------------------------------------------------------------------------
// DEALER (6)
// ---------------------------------------------------------------------------

const dealerOnboarding: PrebuiltWorkflow = {
  key: 'dealer_onboarding',
  category: 'dealer',
  name: 'Dealer Onboarding',
  description: 'Welcome dealer, walk through portal, assign first task.',
  trigger_type: 'dealer_invited',
  graph: build(() => linear([
    trigger('dealer_invited'),
    email('dealer_welcome_email'),
    delay('1d'),
    email('dealer_walkthrough_email'),
    task('Confirm dealer onboarded successfully', 72, 'medium'),
    endNode(),
  ])),
};

const auctionInvite: PrebuiltWorkflow = {
  key: 'auction_invite',
  category: 'dealer',
  name: 'Dealer Auction Invite',
  description: 'Invite dealer to new auction with vehicle details.',
  trigger_type: 'auction_started',
  graph: build(() => linear([
    trigger('auction_started'),
    email('dealer_auction_invite_email'),
    sms('New AutoLenis auction live — check your dealer portal.'),
    endNode(),
  ])),
};

const offerConfirm: PrebuiltWorkflow = {
  key: 'offer_confirm',
  category: 'dealer',
  name: 'Dealer Offer Confirmation',
  description: 'Confirm dealer offer received.',
  trigger_type: 'offer_received',
  graph: build(() => linear([
    trigger('offer_received'),
    email('dealer_offer_confirmed_email'),
    endNode(),
  ])),
};

const winningOffer: PrebuiltWorkflow = {
  key: 'winning_offer',
  category: 'dealer',
  name: 'Winning Offer Notification',
  description: 'Notify winning dealer with next steps.',
  trigger_type: 'offer_selected',
  graph: build(() => linear([
    trigger('offer_selected'),
    email('dealer_winning_offer_email'),
    sms('Congrats — your AutoLenis offer was selected.'),
    task('Confirm dealer delivered vehicle', 96, 'high'),
    endNode(),
  ])),
};

const losingOffer: PrebuiltWorkflow = {
  key: 'losing_offer',
  category: 'dealer',
  name: 'Losing Offer Notification',
  description: 'Notify dealer when another offer was selected.',
  trigger_type: 'offer_selected',
  graph: build(() => linear([
    trigger('offer_selected'),
    email('dealer_losing_offer_email'),
    endNode(),
  ])),
};

const dealerReactivation: PrebuiltWorkflow = {
  key: 'dealer_reactivation',
  category: 'dealer',
  name: 'Dealer Reactivation (30d)',
  description: 'Re-engage dealers inactive for 30 days.',
  trigger_type: 'buyer_inactive', // reuses the inactivity trigger
  graph: build(() => linear([
    trigger('buyer_inactive'),
    email('dealer_reactivation_email'),
    delay('7d'),
    email('dealer_reactivation_final_email'),
    endNode(),
  ])),
};

// ---------------------------------------------------------------------------
// AFFILIATE (5)
// ---------------------------------------------------------------------------

const affiliateOnboarding: PrebuiltWorkflow = {
  key: 'affiliate_onboarding',
  category: 'affiliate',
  name: 'Affiliate Onboarding',
  description: 'Welcome + how-to + first referral nudge.',
  trigger_type: 'affiliate_signup',
  graph: build(() => linear([
    trigger('affiliate_signup'),
    email('affiliate_welcome_email'),
    delay('2d'),
    email('affiliate_first_referral_nudge_email'),
    endNode(),
  ])),
};

const referralReceived: PrebuiltWorkflow = {
  key: 'referral_received',
  category: 'affiliate',
  name: 'Referral Received',
  description: 'Acknowledge referral when buyer signs up via affiliate link.',
  trigger_type: 'buyer_signup',
  graph: build(() => linear([
    trigger('buyer_signup'),
    email('affiliate_referral_received_email'),
    endNode(),
  ])),
};

const referralConverted: PrebuiltWorkflow = {
  key: 'referral_converted',
  category: 'affiliate',
  name: 'Referral Converted',
  description: 'Notify affiliate when their referral completes purchase.',
  trigger_type: 'purchase_completed',
  graph: build(() => linear([
    trigger('purchase_completed'),
    email('affiliate_referral_converted_email'),
    endNode(),
  ])),
};

const commissionUpdate: PrebuiltWorkflow = {
  key: 'commission_update',
  category: 'affiliate',
  name: 'Commission Update',
  description: 'Send payout status notification.',
  trigger_type: 'manual',
  graph: build(() => linear([
    trigger('manual'),
    email('affiliate_commission_update_email'),
    endNode(),
  ])),
};

const affiliateReactivation: PrebuiltWorkflow = {
  key: 'affiliate_reactivation',
  category: 'affiliate',
  name: 'Affiliate Reactivation (30d)',
  description: 'Re-engage inactive affiliate.',
  trigger_type: 'buyer_inactive',
  graph: build(() => linear([
    trigger('buyer_inactive'),
    email('affiliate_reactivation_email'),
    endNode(),
  ])),
};

// ---------------------------------------------------------------------------
// REFINANCE (3)
// ---------------------------------------------------------------------------

const refiSequence: PrebuiltWorkflow = {
  key: 'refi_sequence',
  category: 'refinance',
  name: 'Refinance Qualification Sequence',
  description: '4-touch qualification email sequence.',
  trigger_type: 'refinance_inquiry',
  graph: build(() => linear([
    trigger('refinance_inquiry'),
    email('refi_touch_1_email'),
    delay('1d'),
    email('refi_touch_2_email'),
    delay('2d'),
    email('refi_touch_3_email'),
    delay('3d'),
    email('refi_touch_4_email'),
    endNode(),
  ])),
};

const refiReminder: PrebuiltWorkflow = {
  key: 'refi_reminder',
  category: 'refinance',
  name: 'Refinance Reminder',
  description: '72h no-response follow-up.',
  trigger_type: 'refinance_inquiry',
  graph: build(() => linear([
    trigger('refinance_inquiry'),
    delay('3d'),
    sms('{{firstName}}, refinancing your auto loan only takes a few minutes — reply YES to continue.'),
    endNode(),
  ])),
};

const partnerReferral: PrebuiltWorkflow = {
  key: 'partner_referral',
  category: 'refinance',
  name: 'Partner Referral',
  description: 'Route refi lead to partner and notify admin.',
  trigger_type: 'refinance_inquiry',
  graph: build(() => linear([
    trigger('refinance_inquiry'),
    notify('Refi partner handoff', 'Route {{fullName}} to refinance partner.'),
    email('refi_partner_handoff_email'),
    endNode(),
  ])),
};

export const PREBUILT_WORKFLOWS: PrebuiltWorkflow[] = [
  buyerWelcome, vehicleRequest, depositReminder, auctionLaunch, offerReminder,
  financingFollowup, contractReminder, pickupPrep, postPurchase, inactiveRecovery,
  dealerOnboarding, auctionInvite, offerConfirm, winningOffer, losingOffer, dealerReactivation,
  affiliateOnboarding, referralReceived, referralConverted, commissionUpdate, affiliateReactivation,
  refiSequence, refiReminder, partnerReferral,
];

export function getPrebuilt(key: string): PrebuiltWorkflow | undefined {
  return PREBUILT_WORKFLOWS.find((w) => w.key === key);
}
