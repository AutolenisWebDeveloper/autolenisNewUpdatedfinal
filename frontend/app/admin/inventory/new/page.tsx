import { requireAdmin } from "@/lib/auth/admin-session";
import NewInventoryClient from "./NewInventoryClient";

export const dynamic = "force-dynamic";

export default async function AdminInventoryNewPage() {
  await requireAdmin();
  return <NewInventoryClient />;
}
