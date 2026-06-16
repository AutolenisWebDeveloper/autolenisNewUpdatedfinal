import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Segment,
  SegmentConditions,
  SegmentField,
  SegmentOperator,
  SegmentRule,
} from '../types/crm';
import { writeCrmAuditLog, type CrmAuditActor } from './admin/crm-audit';

// Field whitelist + per-field operator and value type. Anything outside this
// table is rejected at the service layer — the DB stores JSONB so it cannot
// enforce the shape, and unvalidated rules would let a malformed segment
// crash the count query (or worse, leak a column we don't intend to filter on).
type FieldDef = {
  column: string;
  type: 'text' | 'boolean' | 'timestamp' | 'number' | 'array';
  operators: readonly SegmentOperator[];
};

const FIELD_DEFS: Record<SegmentField, FieldDef> = {
  lifecycle_stage: {
    column: 'lifecycle_stage',
    type: 'text',
    operators: ['eq', 'neq'],
  },
  consent_sms: {
    column: 'consent_sms',
    type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  consent_email: {
    column: 'consent_email',
    type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  do_not_contact: {
    column: 'do_not_contact',
    type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  source: {
    column: 'source',
    type: 'text',
    operators: ['eq', 'neq', 'contains', 'not_contains'],
  },
  utm_source: {
    column: 'utm_source',
    type: 'text',
    operators: ['eq', 'neq', 'contains', 'not_contains'],
  },
  utm_campaign: {
    column: 'utm_campaign',
    type: 'text',
    operators: ['eq', 'neq', 'contains', 'not_contains'],
  },
  created_at: {
    column: 'created_at',
    type: 'timestamp',
    operators: ['before', 'after', 'gte', 'lte'],
  },
  lead_score: {
    column: 'lead_score',
    type: 'number',
    operators: ['eq', 'neq', 'gte', 'lte'],
  },
  lead_temperature: {
    column: 'lead_temperature',
    type: 'text',
    operators: ['eq', 'neq'],
  },
  tags: {
    column: 'tags',
    type: 'array',
    operators: ['has_tag', 'not_has_tag'],
  },
};

// Mirrors the contacts_lead_temperature_chk CHECK (migration 06).
const LEAD_TEMPERATURES = ['hot', 'warm', 'cold'];

const LIFECYCLE_STAGES = [
  'lead', 'prequal_started', 'prequal_completed',
  'deposit_pending', 'deposit_paid', 'auction_active',
  'offer_received', 'purchase_completed', 'inactive',
];

const SOURCES = [
  'buyer_signup', 'dealer_signup', 'affiliate_signup',
  'public_form', 'sms_inbound', 'import',
];

function isAllowedOperator(field: SegmentField, op: SegmentOperator): boolean {
  return FIELD_DEFS[field].operators.includes(op);
}

function escapeIlike(input: string): string {
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

// Validate + return a normalized SegmentConditions object. Throws on first
// invalid rule with a human-readable error suitable for the API response.
export function normalizeConditions(input: unknown): SegmentConditions {
  if (!input || typeof input !== 'object') {
    throw new Error('CONDITIONS_INVALID');
  }
  const raw = input as { match?: unknown; rules?: unknown };
  const match = raw.match === 'any' ? 'any' : 'all';
  const rulesRaw = Array.isArray(raw.rules) ? raw.rules : [];

  const rules: SegmentRule[] = rulesRaw.map((r, idx) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`RULE_${idx}_INVALID`);
    }
    const field = (r as { field?: string }).field as SegmentField | undefined;
    const op = (r as { op?: string }).op as SegmentOperator | undefined;
    const value = (r as { value?: unknown }).value;

    if (!field || !(field in FIELD_DEFS)) {
      throw new Error(`RULE_${idx}_FIELD_INVALID`);
    }
    if (!op || !isAllowedOperator(field, op)) {
      throw new Error(`RULE_${idx}_OPERATOR_INVALID`);
    }
    const def = FIELD_DEFS[field];

    // Boolean operators ignore value entirely.
    if (def.type === 'boolean') {
      return { field, op, value: null };
    }

    if (value === undefined || value === null || value === '') {
      throw new Error(`RULE_${idx}_VALUE_REQUIRED`);
    }

    // Numeric fields (lead_score) — coerce and store a real number so the
    // PostgREST comparison is numeric, not lexicographic.
    if (def.type === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) throw new Error(`RULE_${idx}_VALUE_INVALID_NUMBER`);
      return { field, op, value: num };
    }

    // Array fields (tags) — a single tag string to test for membership.
    if (def.type === 'array') {
      return { field, op, value: String(value) };
    }

    if (field === 'lifecycle_stage' && !LIFECYCLE_STAGES.includes(String(value))) {
      throw new Error(`RULE_${idx}_VALUE_INVALID_STAGE`);
    }
    if (field === 'source' && !SOURCES.includes(String(value))) {
      throw new Error(`RULE_${idx}_VALUE_INVALID_SOURCE`);
    }
    if (field === 'lead_temperature' && !LEAD_TEMPERATURES.includes(String(value))) {
      throw new Error(`RULE_${idx}_VALUE_INVALID_TEMPERATURE`);
    }

    return { field, op, value: value as string | number | boolean };
  });

  return { match, rules };
}

// PostgREST builders have an awkward generic signature that changes with every
// chained predicate; we don't care about the exact shape here — we just need
// the chain methods. Using `any` for the local builder type keeps this code
// readable. The output of countContacts / resolveContacts is fully typed.
type AnyBuilder = {
  eq: (col: string, value: unknown) => AnyBuilder;
  neq: (col: string, value: unknown) => AnyBuilder;
  gte: (col: string, value: unknown) => AnyBuilder;
  lte: (col: string, value: unknown) => AnyBuilder;
  ilike: (col: string, value: string) => AnyBuilder;
  not: (col: string, op: string, value: unknown) => AnyBuilder;
  or: (filter: string) => AnyBuilder;
  is: (col: string, value: unknown) => AnyBuilder;
  contains: (col: string, value: unknown) => AnyBuilder;
  select: (cols: string, opts?: Record<string, unknown>) => AnyBuilder;
  limit: (n: number) => AnyBuilder;
};

// Apply one rule to a Supabase query builder. The query starts as
// `from('contacts').is('deleted_at', null)` — every rule narrows it further.
// We deliberately use the chain form (rather than .or()) for `all`-match
// because Supabase already AND-combines successive predicates; for `any`-match
// we collapse all rules into a single .or() string.
function applyAllMatchRule(query: AnyBuilder, rule: SegmentRule): AnyBuilder {
  const def = FIELD_DEFS[rule.field];
  const col = def.column;

  switch (rule.op) {
    case 'eq':           return query.eq(col, rule.value);
    case 'neq':          return query.neq(col, rule.value);
    case 'contains':     return query.ilike(col, `%${escapeIlike(String(rule.value))}%`);
    case 'not_contains': return query.not(col, 'ilike', `%${escapeIlike(String(rule.value))}%`);
    case 'gte':
    case 'after':        return query.gte(col, rule.value);
    case 'lte':
    case 'before':       return query.lte(col, rule.value);
    case 'is_true':      return query.eq(col, true);
    case 'is_false':     return query.eq(col, false);
    // Array membership: tags @> {value}. not_has_tag negates the same op.
    case 'has_tag':      return query.contains(col, [rule.value]);
    case 'not_has_tag':  return query.not(col, 'cs', `{${rule.value}}`);
    default:             return query;
  }
}

// For `any`-match we need a single OR-combined filter string. PostgREST's .or()
// takes a comma-separated list of `column.op.value`. Boolean ops translate to
// `column.eq.true` / `column.eq.false`; contains uses ilike with %wrapping%.
function buildOrFilter(rules: SegmentRule[]): string {
  return rules
    .map((rule) => {
      const def = FIELD_DEFS[rule.field];
      const col = def.column;
      switch (rule.op) {
        case 'eq':           return `${col}.eq.${rule.value}`;
        case 'neq':          return `${col}.neq.${rule.value}`;
        case 'contains':     return `${col}.ilike.*${escapeIlike(String(rule.value))}*`;
        case 'not_contains': return `not.${col}.ilike.*${escapeIlike(String(rule.value))}*`;
        case 'gte':
        case 'after':        return `${col}.gte.${rule.value}`;
        case 'lte':
        case 'before':       return `${col}.lte.${rule.value}`;
        case 'is_true':      return `${col}.eq.true`;
        case 'is_false':     return `${col}.eq.false`;
        case 'has_tag':      return `${col}.cs.{${rule.value}}`;
        case 'not_has_tag':  return `not.${col}.cs.{${rule.value}}`;
        default:             return '';
      }
    })
    .filter(Boolean)
    .join(',');
}

export class SegmentService {
  static readonly FIELD_DEFS = FIELD_DEFS;

  static async getSegment(supabase: SupabaseClient, id: string): Promise<Segment | null> {
    const { data, error } = await supabase
      .from('segments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Segment | null) ?? null;
  }

  static async listSegments(supabase: SupabaseClient): Promise<Segment[]> {
    const { data, error } = await supabase
      .from('segments')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data as Segment[]) ?? [];
  }

  static async createSegment(
    supabase: SupabaseClient,
    input: { name: string; description?: string | null; conditions: unknown },
    actor: CrmAuditActor | null,
  ): Promise<Segment> {
    if (!input.name?.trim()) throw new Error('NAME_REQUIRED');
    const conditions = normalizeConditions(input.conditions);

    // Run an initial count so the row carries a fresh number from the jump.
    const count = await this.countContacts(supabase, conditions);

    const { data, error } = await supabase
      .from('segments')
      .insert({
        name: input.name.trim(),
        description: input.description ?? null,
        conditions,
        contact_count: count,
        last_counted_at: new Date().toISOString(),
        created_by: actor?.adminId ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;

    await writeCrmAuditLog(supabase, actor, {
      action: 'CREATE_SEGMENT',
      entity_type: 'segment',
      entity_id: data.id,
      new_state: data,
    });

    return data as Segment;
  }

  static async updateSegment(
    supabase: SupabaseClient,
    id: string,
    input: { name?: string; description?: string | null; conditions?: unknown },
    actor: CrmAuditActor | null,
  ): Promise<Segment> {
    const before = await this.getSegment(supabase, id);
    if (!before) throw new Error('SEGMENT_NOT_FOUND');

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.conditions !== undefined) {
      const conditions = normalizeConditions(input.conditions);
      patch.conditions = conditions;
      patch.contact_count = await this.countContacts(supabase, conditions);
      patch.last_counted_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('segments')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    await writeCrmAuditLog(supabase, actor, {
      action: 'UPDATE_SEGMENT',
      entity_type: 'segment',
      entity_id: id,
      previous_state: before,
      new_state: data,
    });

    return data as Segment;
  }

  // Count contacts that match the conditions. Always scoped to non-deleted
  // contacts. Returns 0 for an empty rule list — empty segment, not "all
  // contacts" — so a half-built segment in the UI doesn't accidentally
  // pre-target the entire database.
  static async countContacts(
    supabase: SupabaseClient,
    conditions: SegmentConditions,
  ): Promise<number> {
    if (conditions.rules.length === 0) return 0;
    let query = supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null) as unknown as AnyBuilder;

    if (conditions.match === 'all') {
      for (const rule of conditions.rules) {
        query = applyAllMatchRule(query, rule);
      }
    } else {
      const filter = buildOrFilter(conditions.rules);
      if (!filter) return 0;
      query = query.or(filter);
    }

    const { count, error } = (await query) as unknown as {
      count: number | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  // Resolve the actual contact rows for a segment. Used by campaign fan-out.
  // Returns id + email + phone + consent flags + first/last name — enough to
  // gate sends without re-querying per recipient.
  static async resolveContacts(
    supabase: SupabaseClient,
    conditions: SegmentConditions,
    limit = 50_000,
  ): Promise<
    Array<{
      id: string;
      email: string | null;
      phone: string | null;
      first_name: string | null;
      last_name: string | null;
      consent_sms: boolean;
      consent_email: boolean;
      do_not_contact: boolean;
    }>
  > {
    if (conditions.rules.length === 0) return [];

    let query = supabase
      .from('contacts')
      .select('id, email, phone, first_name, last_name, consent_sms, consent_email, do_not_contact')
      .is('deleted_at', null)
      .limit(limit) as unknown as AnyBuilder;

    if (conditions.match === 'all') {
      for (const rule of conditions.rules) {
        query = applyAllMatchRule(query, rule);
      }
    } else {
      const filter = buildOrFilter(conditions.rules);
      if (!filter) return [];
      query = query.or(filter);
    }

    const { data, error } = (await query) as unknown as {
      data: Array<{
        id: string;
        email: string | null;
        phone: string | null;
        first_name: string | null;
        last_name: string | null;
        consent_sms: boolean;
        consent_email: boolean;
        do_not_contact: boolean;
      }> | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
