"use client";

// Phase C3 — Status controls for the article review/detail page.
// Calls PATCH /api/admin/content/[id] and refreshes the server component so the
// new status + badges render. Only shows the transitions that make sense from
// the current status.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Eye, FileText, Archive } from "lucide-react";

type StatusValue = "DRAFT" | "REVIEW_NEEDED" | "PUBLISHED" | "ARCHIVED";

interface Props {
  articleId: string;
  status: StatusValue;
}

const ACTIONS: Array<{
  status: StatusValue;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  variant: "default" | "secondary" | "outline" | "destructive";
}> = [
  { status: "PUBLISHED", label: "Publish", icon: CheckCircle2, variant: "default" },
  { status: "REVIEW_NEEDED", label: "Mark for Review", icon: Eye, variant: "secondary" },
  { status: "DRAFT", label: "Move to Draft", icon: FileText, variant: "outline" },
  { status: "ARCHIVED", label: "Archive", icon: Archive, variant: "destructive" },
];

export default function ArticleStatusActions({ articleId, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<StatusValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(next: StatusValue) {
    setPending(next);
    setError(null);
    try {
      const res = await fetch(`/api/admin/content/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Failed to update status");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setPending(null);
    }
  }

  return (
    <div data-testid="article-status-actions">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => {
          const isCurrent = action.status === status;
          const Icon = action.icon;
          return (
            <Button
              key={action.status}
              variant={action.variant}
              size="sm"
              disabled={isCurrent || pending !== null}
              onClick={() => changeStatus(action.status)}
              data-testid={`article-action-${action.status.toLowerCase()}`}
            >
              <Icon size={14} />
              {isCurrent ? `${action.label} (current)` : action.label}
              {pending === action.status ? "…" : ""}
            </Button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-600 mt-2" data-testid="article-action-error">
          {error}
        </p>
      )}
    </div>
  );
}
