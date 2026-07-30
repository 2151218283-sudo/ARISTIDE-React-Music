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
  loginOpen: boolean;
  logoutLoading: boolean;
  openLogin(): void;
  closeLogin(): void;
  completeLogin(user: UserProfile): void;
  logout(): Promise<boolean>;
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
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const restoreSession = useCallback(async (signal: AbortSignal) => {
    try {
      const session = await requestApi<SessionResponse>("/api/auth/session", { signal });
      if (!signal.aborted) {
        setUser(session.user);
      }
    } catch {
      if (!signal.aborted) {
        setUser(null);
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
      return true;
    } catch {
      return false;
    } finally {
      setLogoutLoading(false);
    }
  }, [logoutLoading]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    loginOpen,
    logoutLoading,
    openLogin,
    closeLogin,
    completeLogin,
    logout,
  }), [
    closeLogin,
    completeLogin,
    loginOpen,
    logout,
    logoutLoading,
    openLogin,
    status,
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
