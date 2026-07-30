"use client";

import { CheckCircle2, X } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import type { UserProfile } from "@/lib/music/models";

import styles from "./QrLoginDialog.module.css";

type QrPhase = "starting" | "waiting" | "scanned" | "authorized" | "expired" | "error";

interface QrChallengeResponse {
  challengeId: string;
  status: "waiting";
  qrImageDataUrl: string;
  expiresAt: number;
}

type QrStatusResponse =
  | { status: "waiting"; expiresAt: number }
  | { status: "scanned"; expiresAt: number }
  | { status: "authorized"; user: UserProfile }
  | { status: "expired" };

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string };
}

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

interface ClientRequestError extends Error {
  code?: string;
}

interface QrLoginDialogProps {
  onAuthorized(user: UserProfile): void;
  onClose(): void;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

type ActiveChallenge = QrChallengeResponse;

function createRequestError(code?: string): ClientRequestError {
  const error = new Error("ECHOFORM_QR_REQUEST_FAILED") as ClientRequestError;
  error.code = code;
  return error;
}

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
    throw createRequestError(body.ok ? undefined : body.error.code);
  }
  return body.data;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden"));
}

function copyForPhase(phase: QrPhase): string {
  switch (phase) {
    case "scanned":
      return "请在手机上确认登录";
    case "authorized":
      return "登录成功";
    case "expired":
      return "二维码已过期";
    case "error":
      return "无法连接登录服务";
    case "starting":
    case "waiting":
      return "使用网易云音乐扫码";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function QrLoginDialog({
  onAuthorized,
  onClose,
  open,
  triggerRef,
}: QrLoginDialogProps) {
  const [phase, setPhase] = useState<QrPhase>("starting");
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<QrPhase>(phase);
  const challengeRef = useRef<ActiveChallenge | null>(challenge);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    challengeRef.current = challenge;
  }, [challenge]);

  const abortPendingRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const restoreTriggerFocus = useCallback(() => {
    triggerRef.current?.focus();
  }, [triggerRef]);

  const closeDialog = useCallback(() => {
    abortPendingRequest();
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    setChallenge(null);
    setPhase("starting");
    onClose();
    restoreTriggerFocus();
  }, [abortPendingRequest, onClose, restoreTriggerFocus]);

  const expireChallenge = useCallback(() => {
    abortPendingRequest();
    setChallenge(null);
    setPhase("expired");
  }, [abortPendingRequest]);

  const startChallenge = useCallback(async () => {
    abortPendingRequest();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const nextChallenge = await requestApi<QrChallengeResponse>("/api/auth/qr", {
        method: "POST",
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      setChallenge(nextChallenge);
      setPhase("waiting");
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        setPhase("error");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [abortPendingRequest]);

  const pollStatus = useCallback(async () => {
    const currentChallenge = challengeRef.current;
    if (!currentChallenge || document.visibilityState !== "visible") {
      return;
    }
    if (currentChallenge.expiresAt <= Date.now()) {
      expireChallenge();
      return;
    }
    abortPendingRequest();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const status = await requestApi<QrStatusResponse>(
        `/api/auth/qr/status?challengeId=${encodeURIComponent(currentChallenge.challengeId)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || challengeRef.current?.challengeId !== currentChallenge.challengeId) {
        return;
      }
      if (status.status === "expired") {
        expireChallenge();
        return;
      }
      if (status.status === "authorized") {
        setChallenge(null);
        setPhase("authorized");
        onAuthorized(status.user);
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches ?? false;
        successTimeoutRef.current = setTimeout(
          closeDialog,
          reducedMotion ? 180 : 320,
        );
        return;
      }
      setChallenge((previous) => previous
        ? { ...previous, expiresAt: status.expiresAt }
        : previous);
      setPhase(status.status);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }
      if (error instanceof Error && "code" in error && error.code === "QR_EXPIRED") {
        expireChallenge();
        return;
      }
      setPhase("error");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [abortPendingRequest, closeDialog, expireChallenge, onAuthorized]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timeoutId = setTimeout(() => {
      void startChallenge();
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      abortPendingRequest();
    };
  }, [abortPendingRequest, open, startChallenge]);

  useEffect(() => {
    if (!open || !challenge || (phase !== "waiting" && phase !== "scanned")) {
      return;
    }
    const remaining = challenge.expiresAt - Date.now();
    const timeoutId = setTimeout(expireChallenge, Math.max(0, remaining));
    return () => clearTimeout(timeoutId);
  }, [challenge, expireChallenge, open, phase]);

  useEffect(() => {
    if (!open || !challenge || (phase !== "waiting" && phase !== "scanned")) {
      return;
    }
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (document.visibilityState !== "visible" || intervalId) {
        return;
      }
      intervalId = setInterval(() => void pollStatus(), 2_000);
    };
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pollStatus();
        startPolling();
      } else {
        stopPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [challenge, open, phase, pollStatus]);

  useEffect(() => {
    if (!open) {
      return;
    }
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-auth-close]")?.focus();
  }, [open]);

  useEffect(() => () => {
    abortPendingRequest();
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
  }, [abortPendingRequest]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = focusableElements(dialog);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) {
    return null;
  }

  const hasQrImage = Boolean(challenge?.qrImageDataUrl)
    && (phase === "waiting" || phase === "scanned");
  const canRefresh = phase === "expired" || phase === "error";

  return (
    <div
      className={styles.scrim}
      data-auth-dialog
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeDialog();
        }
      }}
    >
      <div
        aria-labelledby="qr-login-title"
        aria-modal="true"
        className={styles.dialog}
        data-auth-phase={phase}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.header}>
          <p className={styles.eyebrow}>ECHOFORM / NETEASE</p>
          <IconButton
            data-auth-close
            icon={<X aria-hidden="true" strokeWidth={1.7} />}
            label="关闭登录"
            onClick={closeDialog}
            size="md"
          />
        </div>

        <div className={styles.stage} data-qr-stage data-testid="qr-stage">
          {hasQrImage ? (
            <img
              alt="请使用网易云音乐扫描此登录二维码"
              className={styles.qrImage}
              src={challenge?.qrImageDataUrl}
            />
          ) : phase === "authorized" ? (
            <CheckCircle2 aria-hidden="true" className={styles.successIcon} />
          ) : phase === "starting" ? (
            <span aria-label="正在生成二维码" className={styles.stageSkeleton} role="status" />
          ) : (
            <span aria-hidden="true" className={styles.stageMark}>
              <span />
              <span />
              <span />
            </span>
          )}
        </div>

        <div className={styles.copy}>
          <h2 id="qr-login-title">{copyForPhase(phase)}</h2>
          {phase === "starting" ? <p>正在生成登录二维码</p> : null}
          {phase === "waiting" ? <p>请在网易云音乐中打开扫一扫</p> : null}
          {phase === "scanned" ? <p>请完成手机端确认</p> : null}
          {phase === "authorized" ? <p>正在恢复你的音乐空间</p> : null}
          {phase === "expired" ? <p>刷新后可重新开始</p> : null}
          {phase === "error" ? <p role="alert">请检查网络后重试</p> : null}
        </div>

        <div className={styles.actions}>
          {canRefresh ? (
            <TextButton
              onClick={() => {
                setChallenge(null);
                setPhase("starting");
                void startChallenge();
              }}
              variant="secondary"
            >
              {phase === "expired" ? "刷新二维码" : "重试"}
            </TextButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
