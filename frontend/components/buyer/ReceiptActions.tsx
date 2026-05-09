"use client";

import Link from "next/link";

export default function ReceiptActions({ dealId }: { dealId: string }) {
  return (
    <div className="flex gap-3 print:hidden">
      <button
        onClick={() => window.print()}
        className="px-5 py-2.5 bg-[#0B5FD1] text-white text-sm font-semibold rounded-md hover:bg-[#0A4DB8] transition-colors"
        data-testid="receipt-print-btn"
      >
        Print Receipt
      </button>
      <Link
        href={`/buyer/deal/${dealId}/complete`}
        className="px-5 py-2.5 border border-[#E5E7EB] text-[#374151] text-sm font-semibold rounded-md hover:border-[#0B5FD1] transition-colors"
        data-testid="receipt-back-btn"
      >
        Back to Deal
      </Link>
    </div>
  );
}
