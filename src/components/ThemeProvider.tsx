"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import { extractArtworkPalette } from "@/lib/theme/extractArtworkPalette";
import type { ArtworkPalette } from "@/lib/theme/artworkPalette";

export type ThemePreference = "ink" | "paper" | "artwork";
type TargetStatus = "loading" | "ready" | "error";

interface ArtworkTarget {
  key: string;
  status: TargetStatus;
  url: string | null;
}

interface AppliedTheme {
  kind: ThemePreference;
  palette: ArtworkPalette | null;
}

interface ThemeContextValue {
  available: boolean;
  effective: ThemePreference;
  preference: ThemePreference;
  hydrated: boolean;
  storageError: string | null;
  setPreference(preference: ThemePreference): void;
  setArtworkTarget(target: ArtworkTarget | null): void;
}

const storageKey = "echoform:theme-preference";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function savedPreference(): { preference: ThemePreference | null; error: string | null } {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === null || value === "ink" || value === "paper" || value === "artwork") {
      return { preference: value, error: null };
    }
    return { preference: null, error: "主题设置已损坏，当前使用默认主题。" };
  } catch {
    return { preference: null, error: "无法读取主题设置；本次选择仅在当前页面有效。" };
  }
}

function applyTheme(theme: AppliedTheme): void {
  const root = document.documentElement;
  if (theme.kind === "artwork" && theme.palette) {
    const palette = theme.palette;
    const variables = {
      "--ef-artwork-primary": palette.primary,
      "--ef-artwork-secondary": palette.secondary,
      "--ef-artwork-surface": palette.surface,
      "--ef-artwork-raised": palette.raised,
      "--ef-artwork-overlay": palette.overlay,
      "--ef-artwork-on-surface": palette.onSurface,
      "--ef-artwork-on-surface-muted": palette.onSurfaceMuted,
      "--ef-artwork-on-primary": palette.onPrimary,
    };
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  }
  root.dataset.theme = theme.kind;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { mode, status, user } = useAuth();
  const available = status === "ready" && mode === "real" && user !== null;
  const [preference, setPreferenceState] = useState<ThemePreference>("artwork");
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [target, setTarget] = useState<ArtworkTarget | null>(null);
  const [applied, setApplied] = useState<AppliedTheme>({ kind: "ink", palette: null });
  const visible = useMemo<AppliedTheme>(() => (
    available ? applied : { kind: "ink", palette: null }
  ), [available, applied]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(storageKey, next);
      setStorageError(null);
    } catch {
      setStorageError("无法保存主题设置；本次选择仅在当前页面有效。");
    }
  }, []);

  const setArtworkTarget = useCallback((next: ArtworkTarget | null) => {
    setTarget(next);
  }, []);

  useLayoutEffect(() => {
    const saved = savedPreference();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPreferenceState(saved.preference ?? "artwork");
      setStorageError(saved.error);
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const resolveImmediately = (next: AppliedTheme): (() => void) => {
      queueMicrotask(() => {
        if (!cancelled) setApplied(next);
      });
      return () => { cancelled = true; };
    };
    if (!available || target?.status === "error") {
      return resolveImmediately({ kind: "ink", palette: null });
    }
    if (preference === "ink" || preference === "paper") {
      return resolveImmediately({ kind: preference, palette: null });
    }
    if (!target || target.status === "loading") return;
    if (!target.url) {
      return resolveImmediately({ kind: "ink", palette: null });
    }
    const controller = new AbortController();
    void extractArtworkPalette(target.url, controller.signal).then((palette) => {
      if (!controller.signal.aborted) {
        setApplied(palette ? { kind: "artwork", palette } : { kind: "ink", palette: null });
      }
    });
    return () => controller.abort();
  }, [available, preference, target]);

  useLayoutEffect(() => applyTheme(visible), [visible]);

  const value = useMemo<ThemeContextValue>(() => ({
    available,
    effective: visible.kind,
    preference,
    hydrated,
    storageError,
    setPreference,
    setArtworkTarget,
  }), [available, preference, hydrated, storageError, setArtworkTarget, setPreference, visible.kind]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}

export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

export function useArtworkThemeTarget(target: ArtworkTarget): void {
  const theme = useOptionalTheme();
  const setArtworkTarget = theme?.setArtworkTarget;
  const { key, status, url } = target;
  useEffect(() => {
    setArtworkTarget?.({ key, status, url });
    return () => setArtworkTarget?.(null);
  }, [setArtworkTarget, key, status, url]);
}
