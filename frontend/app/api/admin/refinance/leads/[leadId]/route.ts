import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { getLeadByLeadId } from "@/lib/services/refinance/refinance-lead.service";

export const dynamic = "force-dynamic";

// GET /api/admin/refinance/leads/[leadId] — read-only detail view.
// Admin can NEVER make a credit decision on a lead. No approve/reject endpoint exists.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" }, correlationId: crypto.randomUUID() },
      { status: 401 },
    );
  }
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
