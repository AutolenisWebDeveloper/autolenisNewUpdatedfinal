import Link from "next/link";
import { ShieldOff } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-10 text-center">
        <div className="w-16 h-16 rounded-full bg-[#EFF6FF] flex items-center justify-center mx-auto mb-6">
          <ShieldOff size={28} className="text-[#0B5FD1]" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-3">Access Restricted</h1>
        <p className="text-[#4B5563] text-sm leading-relaxed mb-8">
          You don&apos;t have permission to access this area.
          If you believe this is a mistake, please sign in with the correct account.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/auth/signin"
            className="w-full py-3 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/"
            className="w-full py-3 border border-[#E5E7EB] text-[#4B5563] font-medium text-sm rounded-xl hover:bg-[#F8F9FB] transition-colors"
          >
            Return to Homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
