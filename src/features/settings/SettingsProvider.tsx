"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { defaultSettings, type SettingsIssue, type SettingsPreferences } from "./settingsModel";
import { clearSettings, readSettings, writeSettings } from "./settingsStorage";

type SettingKey = keyof SettingsPreferences;
type SettingErrors = Partial<Record<SettingKey, string>>;

interface SettingsContextValue {
  preferences: SettingsPreferences;
  getPreferences(): SettingsPreferences;
  hydrated: boolean;
  issue: SettingsIssue | "unavailable";
  errors: SettingErrors;
  effectiveReducedMotion: boolean;
  setPreference<K extends SettingKey>(key: K, value: SettingsPreferences[K]): void;
  reset(): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<SettingsPreferences>({ ...defaultSettings });
  const preferencesRef = useRef(preferences);
  const [hydrated, setHydrated] = useState(false);
  const [issue, setIssue] = useState<SettingsContextValue["issue"]>(null);
  const [errors, setErrors] = useState<SettingErrors>({});
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  useLayoutEffect(() => {
    const result = readSettings(browserStorage());
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (result.ok) {
        preferencesRef.current = result.value.preferences;
        setPreferences(result.value.preferences);
        setIssue(result.value.issue);
      } else {
        setIssue("unavailable");
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const update = () => setSystemReducedMotion(query.matches);
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
  }, []);

  const effectiveReducedMotion = preferences.reducedMotion || systemReducedMotion;
  useLayoutEffect(() => {
    document.documentElement.dataset.reducedMotion = effectiveReducedMotion ? "true" : "false";
  }, [effectiveReducedMotion]);

  const setPreference = useCallback(<K extends SettingKey>(
    key: K,
    value: SettingsPreferences[K],
  ) => {
    const next = { ...preferencesRef.current, [key]: value };
    preferencesRef.current = next;
    setPreferences(next);
    const saved = issue !== "future" && writeSettings(browserStorage(), next);
    setErrors((previous) => {
      const nextErrors = { ...previous };
      if (saved) delete nextErrors[key];
      else nextErrors[key] = "保存失败；本次更改仅在当前页面有效。";
      return nextErrors;
    });
    if (saved) setIssue(null);
  }, [issue]);

  const reset = useCallback(() => {
    const next = { ...defaultSettings };
    preferencesRef.current = next;
    setPreferences(next);
    const cleared = clearSettings(browserStorage());
    setErrors({});
    setIssue(cleared ? null : "unavailable");
  }, []);

  const getPreferences = useCallback(() => preferencesRef.current, []);

  const value = useMemo<SettingsContextValue>(() => ({
    preferences,
    getPreferences,
    hydrated,
    issue,
    errors,
    effectiveReducedMotion,
    setPreference,
    reset,
  }), [preferences, getPreferences, hydrated, issue, errors, effectiveReducedMotion, setPreference, reset]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("Settings hooks must be used inside SettingsProvider.");
  return settings;
}

export function useOptionalSettings(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
