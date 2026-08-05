"use client";

import type { KeyboardEvent, RefObject } from "react";
import { useEffect, useRef } from "react";

import { TextButton } from "@/components/TextButton";

import styles from "./ClearHistoryDialog.module.css";

interface ClearHistoryDialogProps {
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
  open: boolean;
  pending: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden"));
}

export function ClearHistoryDialog({
  error,
  onCancel,
  onConfirm,
  open,
  pending,
  triggerRef,
}: ClearHistoryDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-clear-history-cancel]")?.focus();
  }, [open]);

  useEffect(() => {
    if (open && pending) {
      dialogRef.current?.focus({ preventScroll: true });
    }
  }, [open, pending]);

  const close = (): void => {
    if (pending) {
      return;
    }
    onCancel();
    triggerRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
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
      event.preventDefault();
      dialog.focus({ preventScroll: true });
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

  return (
    <div className={styles.scrim}>
      <div
        aria-busy={pending || undefined}
        aria-describedby="clear-history-description"
        aria-labelledby="clear-history-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <p className={styles.eyebrow}>ECHOFORM / LOCAL HISTORY</p>
        <div className={styles.copy}>
          <h2 id="clear-history-title">清空播放记录？</h2>
          <p id="clear-history-description">
            仅删除当前浏览器中的本地记录，不会影响网易云账号、播放队列或音频。
          </p>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <TextButton
            data-clear-history-cancel
            disabled={pending}
            onClick={close}
            variant="secondary"
          >
            取消
          </TextButton>
          <TextButton loading={pending} onClick={onConfirm} variant="danger">
            清空记录
          </TextButton>
        </div>
      </div>
    </div>
  );
}
