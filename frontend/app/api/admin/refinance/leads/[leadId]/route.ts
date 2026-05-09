import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { getLeadByLeadId } from "@/lib/services/refinance/refinance-lead.service";

export const dynamic = "force-dynamic";

// GET /api/admin/refinance/leads/[leadId] — read-only detail view.
// Admin can NEVER make a credit decision on a lead. No approve/reject endpoint exists.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  await requireAdmin();
  const { leadId } = await params;

  const lead = await getLeadByLeadId(leadId);
  if (!lead) {
    return NextResponse.json(
      { error: { code: "LEAD_NOT_FOUND", message: "Lead does not exist" }, correlationId: crypto.randomUUID() },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, data: lead });
}
