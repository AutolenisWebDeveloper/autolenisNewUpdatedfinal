import Link from "next/link";
import { Clock } from "lucide-react";

export default function SessionExpiredPage() {
  return (
    <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-10 text-center">
        <div className="w-16 h-16 rounded-full bg-[#FFF7ED] flex items-center justify-center mx-auto mb-6">
          <Clock size={28} className="text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-3">Session Expired</h1>
        <p className="text-[#4B5563] text-sm leading-relaxed mb-8">
          Your session has timed out for security.
          Sign in again to continue where you left off.
        </p>
        <Link
          href="/auth/signin"
          className="block w-full py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
        >
          Sign In Again
        </Link>
      </div>
    </div>
  );
}
