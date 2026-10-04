"use client";

import { Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useOptionalTheme, type ThemePreference } from "./ThemeProvider";
import styles from "./ThemeSwitcher.module.css";

const choices: { label: string; value: ThemePreference }[] = [
  { label: "深色", value: "ink" },
  { label: "浅色", value: "paper" },
  { label: "封面", value: "artwork" },
];

export function ThemeSwitcher() {
  const theme = useOptionalTheme();
  return theme ? <ThemeSwitcherContent theme={theme} /> : null;
}

function ThemeSwitcherContent({ theme }: { theme: NonNullable<ReturnType<typeof useOptionalTheme>> }) {
  const { available, effective, preference, setPreference } = theme;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="显示主题"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        title="显示主题"
        type="button"
      >
        <Palette aria-hidden="true" strokeWidth={1.7} />
      </button>
      {open ? (
        <div
          aria-label="显示主题"
          className={styles.menu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
          role="dialog"
        >
          <p className={styles.heading}>显示主题</p>
          <div aria-label="主题模式" className={styles.segmented} role="group">
            {choices.map((choice) => (
              <button
                aria-pressed={preference === choice.value}
                className={styles.choice}
                disabled={!available && choice.value !== "ink"}
                key={choice.value}
                onClick={() => {
                  setPreference(choice.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                type="button"
              >
                {choice.label}
              </button>
            ))}
          </div>
          {!available ? <p className={styles.hint}>登录后可选择浅色或封面主题</p> : null}
          {available && preference === "artwork" && effective === "ink"
            ? <p className={styles.hint}>当前封面暂不可用于取色</p> : null}
        </div>
      ) : null}
    </div>
  );
}
