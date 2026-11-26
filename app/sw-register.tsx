"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if ((process.env.NEXT_PUBLIC_UK_DEMO_ONLY === "true" || window.location.pathname.startsWith("/workspace"))) return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    }
  }, []);
  return null;
}
