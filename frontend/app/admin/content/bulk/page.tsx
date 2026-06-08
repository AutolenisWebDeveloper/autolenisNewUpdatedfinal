// Bulk Article Management — server shell.
//
// Ops tool for selecting, filtering, previewing, and bulk publishing/archiving
// generated ContentArticle rows without opening each one. Complements the
// read-first Content Engine dashboard (/admin/content) with a dense, action-
// oriented worktable. Auth is enforced here (and by the admin layout); the
// filter option sources are passed to the client so the dropdowns are populated
// even before any article exists.

import { requireAdmin } from "@/lib/auth/admin-session";
import {
  CLUSTER_OPTIONS,
  METRO_OPTIONS,
} from "@/lib/services/admin/admin-content.service";
import ArticleManagerClient from "./ArticleManagerClient";

export const dynamic = "force-dynamic";

export default async function BulkArticleManagerPage() {
  await requireAdmin();
  return (
    <ArticleManagerClient clusters={[...CLUSTER_OPTIONS]} metros={[...METRO_OPTIONS]} />
  );
}
