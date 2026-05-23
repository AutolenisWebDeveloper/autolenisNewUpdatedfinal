import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export default function DealerNotFound() {
  return (
    <div
      className="p-6 md:p-12 max-w-xl mx-auto"
      data-testid="dealer-not-found"
    >
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
        <Search size={22} className="text-slate-400 mb-3" />
        <h1 className="text-lg font-bold text-slate-900">Not found</h1>
        <p className="text-sm text-slate-600 mt-1 mb-4">
          We couldn&apos;t find what you were looking for. It may have been
          archived, completed, or never existed for this account.
        </p>
        <Link href="/dealer/dashboard">
          <Button className="min-h-[44px]">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
