"use client";

import { useEffect, useState } from "react";

import { useOptionalSettings } from "./SettingsProvider";

export function useReducedMotion(): boolean {
  const settings = useOptionalSettings();
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    if (settings) return undefined;
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const update = () => setSystemReduced(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    if (typeof query.addListener === "function") {
      query.addListener(update);
      return () => query.removeListener(update);
    }
    return undefined;
  }, [settings]);

  return settings?.effectiveReducedMotion ?? systemReduced;
}
