// /admin — the console root.
//
// Batch 2 IA: this segment had no page. proxy.ts passes an authenticated admin
// straight through for /admin (its ROLE_PORTAL_MAP is only consulted on the
// non-admin branch), and next.config.mjs has no /admin rule — so a signed-in
// admin who typed /admin, or followed the "Admin" breadcrumb in the dealer and
// affiliate command centers, got a 404 rendered inside the admin shell.
//
// The landing page itself is unchanged; this only makes the root resolve to it.
import { redirect } from "next/navigation";
import { ADMIN_LANDING } from "@/lib/admin/nav";

export default function AdminRootPage() {
  redirect(ADMIN_LANDING);
}
