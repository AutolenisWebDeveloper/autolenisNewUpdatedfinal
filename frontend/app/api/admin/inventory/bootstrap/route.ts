import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { bootstrapInventory } from "@/lib/services/inventory/orchestrator";

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin || admin.role !== "SUPER_ADMIN") return adminError("FORBIDDEN", "Super Admin only", 403);
  bootstrapInventory().catch(err => logger.error("Bootstrap error:", err));
  await createAuditLog(admin, request, {
    action: "INVENTORY_BOOTSTRAP_STARTED",
    entityType: "Inventory",
    entityId: "global",
  });
  return adminSuccess({ started: true, message: "Inventory bootstrap started in background" });
}
