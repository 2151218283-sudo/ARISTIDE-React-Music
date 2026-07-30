"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { UserProfile } from "@/lib/music/models";
import { PlayerRuntimeContext } from "@/features/player/playerContext";

type AuthStatus = "loading" | "ready";

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string };
}

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

interface SessionResponse {
  mode: "real" | "demo";
  user: UserProfile | null;
}

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  mode: "real" | "demo";
  modeChanging: boolean;
  loginOpen: boolean;
  logoutLoading: boolean;
  openLogin(): void;
  closeLogin(): void;
  completeLogin(user: UserProfile): void;
  logout(): Promise<boolean>;
  setMode(mode: "real" | "demo"): Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function requestApi<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error("ECHOFORM_AUTH_REQUEST_FAILED");
  }
  return body.data;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const playerRuntime = useContext(PlayerRuntimeContext);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [mode, setModeState] = useState<"real" | "demo">("real");
  const [modeChanging, setModeChanging] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const restoreSession = useCallback(async (signal: AbortSignal) => {
    try {
      const session = await requestApi<SessionResponse>("/api/auth/session", { signal });
      if (!signal.aborted) {
        setUser(session.user);
        setModeState(session.mode);
      }
    } catch {
      if (!signal.aborted) {
        setUser(null);
        setModeState("real");
      }
    } finally {
      if (!signal.aborted) {
        setStatus("ready");
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      void restoreSession(controller.signal);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [restoreSession]);

  const openLogin = useCallback(() => {
    if (status === "ready") {
      setLoginOpen(true);
    }
  }, [status]);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
  }, []);

  const completeLogin = useCallback((nextUser: UserProfile) => {
    setUser(nextUser);
  }, []);

  const logout = useCallback(async (): Promise<boolean> => {
    if (logoutLoading) {
      return false;
    }
    setLogoutLoading(true);
    try {
      await requestApi<SessionResponse>("/api/auth/logout", { method: "POST" });
      setUser(null);
      setModeState("real");
      return true;
    } catch {
      return false;
    } finally {
      setLogoutLoading(false);
    }
  }, [logoutLoading]);

  const setMode = useCallback(async (nextMode: "real" | "demo"): Promise<boolean> => {
    if (modeChanging) {
      return false;
    }
    if (mode === nextMode) {
      return true;
    }

    playerRuntime?.dispatch({ type: "UNLOAD" });
    setModeChanging(true);
    try {
      const session = await requestApi<SessionResponse>("/api/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      setModeState(session.mode);
      setUser(session.user);
      return true;
    } catch {
      return false;
    } finally {
      setModeChanging(false);
    }
  }, [mode, modeChanging, playerRuntime]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    mode,
    modeChanging,
    loginOpen,
    logoutLoading,
    openLogin,
    closeLogin,
    completeLogin,
    logout,
    setMode,
  }), [
    closeLogin,
    completeLogin,
    loginOpen,
    logout,
    logoutLoading,
    mode,
    modeChanging,
    openLogin,
    status,
    setMode,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
