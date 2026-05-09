"use client";

import { useEffect } from "react";

// Feature 30 — PWA Service Worker Registration
// Registers the service worker silently; errors are non-fatal.
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {
          // Non-fatal — app works normally without service worker
        });
    }
  }, []);

  return null;
}
