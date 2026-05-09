"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

export default function CopyReferralCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard permission denied — show brief error state
      setCopied(false);
    });
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleCopy} className="h-7 px-2.5 text-xs">
      {copied ? <Check size={12} className="mr-1 text-green-600" /> : <Copy size={12} className="mr-1" />}
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
