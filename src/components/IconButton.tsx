import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./IconButton.module.css";

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> {
  icon: ReactNode;
  label: string;
  loading?: boolean;
  pressed?: boolean;
  size?: IconButtonSize;
  tooltip?: string;
}

export function IconButton({
  className,
  disabled = false,
  icon,
  label,
  loading = false,
  pressed,
  size = "md",
  title,
  tooltip,
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  const classes = [styles.button, styles[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      aria-busy={loading || undefined}
      aria-label={label}
      aria-pressed={pressed}
      className={classes}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      title={title ?? tooltip ?? label}
      type={type}
    >
      <span className={styles.iconSlot} aria-hidden="true">
        {loading ? <span className={styles.spinner} /> : icon}
      </span>
    </button>
  );
}
