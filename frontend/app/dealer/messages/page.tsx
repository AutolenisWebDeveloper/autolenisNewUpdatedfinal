import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { MessageSquare } from "lucide-react";
import Link from "next/link";

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
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-messages-page">
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Messages</h1>
      </div>
      {threads.length === 0 ? (
        <p className="text-slate-500 text-sm">No active deal threads. Messaging is available once a deal is created.</p>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/dealer/messages/${t.id}`}
              data-testid={`message-thread-${t.id}`}
              className="block bg-white border border-slate-200 hover:border-al-primary/40 hover:shadow-sm rounded-xl p-4 transition-all"
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
    </div>
  );
}
