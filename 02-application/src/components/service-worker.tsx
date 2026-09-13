"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (PRD F-6.1). Registration is safe to run on
 * every load — the browser no-ops if already registered. The SW is what
 * enables Web Push (push + notificationclick events).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("SW registration failed", err));
  }, []);

  return null;
}
