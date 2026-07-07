import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import type { ContactSource } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

const VALID_SOURCES: ContactSource[] = [
  'buyer_signup',
  'dealer_signup',
  'affiliate_signup',
  'public_form',
  'sms_inbound',
  'import',
];

type ParsedRow = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  source?: string;
  consent_sms?: string;
  consent_email?: string;
};

// Minimal RFC-4180-ish CSV parser: handles quoted fields and escaped quotes.
// Newlines inside quoted fields are supported.
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

function toBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

export async function POST(req: Request) {
  const actor = await requirePermissionActor("comms.bulk_send");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const contentType = req.headers.get('content-type') ?? '';

  let csvText = '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'FILE_REQUIRED' }, { status: 400 });
    }
    csvText = await file.text();
  } else if (contentType.includes('application/json')) {
    const body = (await req.json()) as { csv?: string };
    csvText = body.csv ?? '';
  } else {
    csvText = await req.text();
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }

  const rows = parseCsv(csvText).filter((r) => r.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dataRows = rows.slice(1);

  const idx = (name: string) => header.indexOf(name);
  const supabase = getServiceSupabase();

  let imported = 0;
  let duplicates_merged = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const parsed: ParsedRow = {
      first_name: idx('first_name') >= 0 ? row[idx('first_name')]?.trim() : undefined,
      last_name: idx('last_name') >= 0 ? row[idx('last_name')]?.trim() : undefined,
      email: idx('email') >= 0 ? row[idx('email')]?.trim() : undefined,
      phone: idx('phone') >= 0 ? row[idx('phone')]?.trim() : undefined,
      source: idx('source') >= 0 ? row[idx('source')]?.trim() : undefined,
      consent_sms: idx('consent_sms') >= 0 ? row[idx('consent_sms')]?.trim() : undefined,
      consent_email: idx('consent_email') >= 0 ? row[idx('consent_email')]?.trim() : undefined,
    };

    if (!parsed.email && !parsed.phone) {
      errors.push({ row: i + 2, error: 'EMAIL_OR_PHONE_REQUIRED' });
      continue;
    }

    const sourceRaw = (parsed.source ?? 'import') as ContactSource;
    const source: ContactSource = VALID_SOURCES.includes(sourceRaw) ? sourceRaw : 'import';

    // Check for an existing row before upsert so we can report duplicates.
    let existed = false;
    if (parsed.email) {
      const { data } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', parsed.email.toLowerCase())
        .is('deleted_at', null)
        .maybeSingle();
      if (data) existed = true;
    }
    if (!existed && parsed.phone) {
      const { data } = await supabase
        .from('contacts')
        .select('id')
        .eq('phone', parsed.phone)
        .is('deleted_at', null)
        .maybeSingle();
      if (data) existed = true;
    }

    try {
      await ContactService.upsertContact(supabase, {
        email: parsed.email ?? null,
        phone: parsed.phone ?? null,
        firstName: parsed.first_name || undefined,
        lastName: parsed.last_name || undefined,
        source,
        consentEmail: toBool(parsed.consent_email),
        consentSms: toBool(parsed.consent_sms),
        consentText: 'CSV import',
      });
      if (existed) duplicates_merged++;
      else imported++;
    } catch (err) {
      errors.push({
        row: i + 2,
        error: err instanceof Error ? err.message : 'IMPORT_FAILED',
      });
    }
  }

  await writeCrmAuditLog(supabase, actor, {
    action: 'CRM_CONTACTS_IMPORT',
    entity_type: 'contact',
    entity_id: 'csv_import',
    metadata: { imported, duplicates_merged, errors_count: errors.length, total_rows: dataRows.length },
  });

  return NextResponse.json({ imported, duplicates_merged, errors });
}
