"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";

interface AnnouncementBannerProps {
  message: string;
  linkText?: string;
  linkHref?: string;
}

const DISMISSED_KEY = "autolenis_announcement_dismissed_v1";

export default function AnnouncementBanner({
  message,
  linkText,
  linkHref,
}: AnnouncementBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (!dismissed) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // localStorage unavailable (private browsing) — just hide
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="relative w-full bg-[#0B5FD1] text-white px-4 py-2.5 text-center text-sm font-medium z-[60]"
      role="banner"
      aria-label="Site announcement"
      data-testid="announcement-banner"
    >
      <span>{message}</span>
      {linkHref && linkText && (
        <>
          {" "}
          <Link
            href={linkHref}
            className="underline underline-offset-2 font-semibold hover:text-white/80 transition-colors ml-1"
            data-testid="announcement-banner-link"
          >
            {linkText}
          </Link>
        </>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/20 transition-colors"
        data-testid="announcement-banner-dismiss"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
