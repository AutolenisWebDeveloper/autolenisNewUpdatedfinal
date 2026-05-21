import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth/admin-session';

export const dynamic = 'force-dynamic';

// Lightweight admin roster used to populate assignment / escalation pickers
// inside the CRM inbox. Returns the calling admin first so the typical
// "escalate to me" path is one click.
export async function GET() {
  const me = await requireAdmin();

  const admins = await prisma.admin.findMany({
    select: {
      id: true,
      role: true,
      user: { select: { email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const shaped = admins.map((a) => ({
    id: a.id,
    email: a.user.email,
    role: a.role,
    is_self: a.id === me.adminId,
  }));

  // Sort: caller first, then alphabetical by email.
  shaped.sort((a, b) => {
    if (a.is_self && !b.is_self) return -1;
    if (!a.is_self && b.is_self) return 1;
    return a.email.localeCompare(b.email);
  });

  return NextResponse.json({ data: shaped });
}
