// Pure lead temperature + score helpers shared by the Leads/Contacts list.
// Extracted from ContactList so they can be unit-tested without React.
// NULL-SAFE: works whether or not migration 06 (lead_score / lead_temperature)
// has been applied — falls back to the lifecycle-derived temperature and treats
// a missing score as the lowest sortable value.
import type { LifecycleStage } from '@/lib/types/crm';
import type { Temperature } from './ui/tokens';

const HOT_STAGES: LifecycleStage[] = [
  'deposit_pending', 'deposit_paid', 'auction_active', 'offer_received',
];
const WARM_STAGES: LifecycleStage[] = ['prequal_started', 'prequal_completed'];

/** Presentational temperature derived from lifecycle stage (no new data). */
export function temperatureForStage(stage: LifecycleStage): Temperature {
  if (HOT_STAGES.includes(stage)) return 'hot';
  if (WARM_STAGES.includes(stage)) return 'warm';
  return 'cold';
}

type TemperatureSource = {
  lead_temperature?: string | null;
  lifecycle_stage: LifecycleStage;
};

/**
 * Resolve a contact's temperature from the REAL `lead_temperature` column,
 * falling back to the lifecycle-derived temperature when it is null/undefined
 * or not one of the known values (migration 06 not yet applied, or unscored).
 */
export function resolveTemperature(c: TemperatureSource): Temperature {
  if (c.lead_temperature === 'hot' || c.lead_temperature === 'warm' || c.lead_temperature === 'cold') {
    return c.lead_temperature;
  }
  return temperatureForStage(c.lifecycle_stage);
}

/**
 * Sort key for the REAL `lead_score`. A null/undefined score sorts as the
 * lowest possible value so unscored contacts rank last in a descending sort.
 */
export function leadScoreSortValue(c: { lead_score?: number | null }): number {
  return c.lead_score ?? Number.NEGATIVE_INFINITY;
}
