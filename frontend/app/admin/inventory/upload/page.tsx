import { requireAdmin } from "@/lib/auth/admin-session";
import BulkUploadClient from "./BulkUploadClient";

export const dynamic = "force-dynamic";

export default async function AdminInventoryBulkUploadPage() {
  await requireAdmin();
  return <BulkUploadClient />;
}
