import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, EmptyState, CARD, CARD_HOVER } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DealerMessagesPage() {
  const dealer = await requireDealer();
  const threads = await prisma.messageThread.findMany({
    where: { participants: { some: { userId: dealer.userId } } },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
  });

  return (
    <PageContainer testId="dealer-messages-page">
      <PageHeader
        title="Messages"
        subtitle="Deal threads with buyers and the AutoLenis team."
        actions={
          <Button size="sm" variant="outline" href="/dealer/messages/new" data-testid="new-message-btn">
            <Plus size={14} /> New message
          </Button>
        }
      />
      {threads.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No active threads"
          body="Messaging is available once a deal is created. Start a new message or wait for a deal thread to open."
          testId="no-dealer-threads"
        />
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/dealer/messages/${t.id}`}
              data-testid={`message-thread-${t.id}`}
              className={cn(CARD, CARD_HOVER, "block p-4")}
            >
              <p className="font-semibold text-slate-800 text-sm">Deal Thread</p>
              {t.messages[0] && (
                <p className="text-xs text-slate-500 mt-1 truncate">
                  {t.messages[0].isRedacted ? "[Redacted]" : t.messages[0].content}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
