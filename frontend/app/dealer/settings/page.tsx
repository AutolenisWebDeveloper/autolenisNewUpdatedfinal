import { requireDealer } from "@/lib/auth/dealer-session";
import { Settings } from "lucide-react";
import DealerSettingsClient from "./DealerSettingsClient";

export default async function DealerSettingsPage() {
  await requireDealer();
  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="dealer-settings-page">
      <div className="flex items-center gap-3 mb-6">
        <Settings size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
      </div>
      <DealerSettingsClient />
    </div>
  );
}
