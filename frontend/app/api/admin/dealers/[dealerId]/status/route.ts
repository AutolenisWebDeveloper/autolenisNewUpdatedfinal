import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { setDealerStatus } from "@/lib/services/dealer/dealer-profile.service";
import { z } from "zod";

interface Props { params: Promise<{ dealerId: string }> }
const schema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]), reason: z.string().min(5) });

async function handleStatusChange(request: NextRequest, params: Props["params"]) {
  const { dealerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  // TERMINATED is irreversible — only SUPER_ADMIN can issue
  if (parsed.data.status === "TERMINATED" && admin.role !== "SUPER_ADMIN") {
    return adminError("FORBIDDEN", "Only SUPER_ADMIN can terminate a dealer", 403);
  }
  // SUSPENDED requires elevated privileges
  if (parsed.data.status === "SUSPENDED" &&
    !["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "OPERATIONS_ADMIN or SUPER_ADMIN required to suspend a dealer", 403);
  }

  const dealer = await setDealerStatus(dealerId, parsed.data.status, admin.adminId);
  return adminSuccess({ dealer });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  return handleStatusChange(request, params);
}

export async function POST(request: NextRequest, { params }: Props) {
  return handleStatusChange(request, params);
}
