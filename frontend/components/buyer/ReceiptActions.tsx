"use client";

import Link from "next/link";

export default function ReceiptActions({ dealId }: { dealId: string }) {
  return (
    <div className="flex gap-3 print:hidden">
      <button
        onClick={() => window.print()}
        className="px-5 py-2.5 bg-al-primary text-white text-sm font-semibold rounded-md hover:bg-al-primary-hover transition-colors"
        data-testid="receipt-print-btn"
      >
        Print Receipt
      </button>
      <Link
        href={`/buyer/deal/${dealId}/complete`}
        className="px-5 py-2.5 border border-[#E5E7EB] text-[#374151] text-sm font-semibold rounded-md hover:border-al-primary transition-colors"
        data-testid="receipt-back-btn"
      >
        Back to Deal
      </Link>
    </div>
  );
}
