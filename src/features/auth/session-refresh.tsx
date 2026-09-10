"use client";

import { useEffect } from "react";

export function SessionRefresh() {
  useEffect(() => {
    // Revalidate protected content restored from the browser back/forward cache.
    const refresh = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", refresh);
    return () => window.removeEventListener("pageshow", refresh);
  }, []);
  return null;
}
