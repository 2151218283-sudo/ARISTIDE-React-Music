"use client";

import { forwardRef } from "react";

import styles from "./BrandMark.module.css";

interface BrandMarkProps {
  loading?: boolean;
  onClick(): void;
}

export const BrandMark = forwardRef<HTMLButtonElement, BrandMarkProps>(
  function BrandMark({ loading = false, onClick }, ref) {
    const label = loading ? "正在恢复登录状态" : "使用网易云音乐登录";

    return (
      <button
        aria-busy={loading || undefined}
        aria-label={label}
        className={styles.button}
        data-loading={loading || undefined}
        disabled={loading}
        onClick={onClick}
        ref={ref}
        title={label}
        type="button"
      >
        <span aria-hidden="true" className={styles.mark}>
          <span />
          <span />
          <span />
        </span>
      </button>
    );
  },
);
