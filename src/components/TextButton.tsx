import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import styles from "./TextButton.module.css";

export type TextButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface TextButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  children: ReactNode;
  loading?: boolean;
  variant?: TextButtonVariant;
}

export const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton({
  children,
  className,
  disabled = false,
  loading = false,
  type = "button",
  variant = "primary",
  ...buttonProps
}, ref) {
  const classes = [styles.button, styles[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      aria-busy={loading || undefined}
      className={classes}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      ref={ref}
      type={type}
    >
      <span className={styles.leadingSlot} aria-hidden="true">
        {loading ? <span className={styles.spinner} /> : null}
      </span>
      <span className={styles.label}>{children}</span>
      <span className={styles.trailingSlot} aria-hidden="true" />
    </button>
  );
});
