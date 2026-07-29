import styles from "./Skeleton.module.css";

export type SkeletonVariant =
  | "line"
  | "line-short"
  | "block"
  | "artwork"
  | "button";

export interface SkeletonProps {
  className?: string;
  label?: string;
  variant?: SkeletonVariant;
}

const variantClasses: Record<SkeletonVariant, string> = {
  line: styles.line,
  "line-short": styles.lineShort,
  block: styles.block,
  artwork: styles.artwork,
  button: styles.button,
};

export function Skeleton({
  className,
  label,
  variant = "block",
}: SkeletonProps) {
  const classes = [styles.skeleton, variantClasses[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className={classes}
      data-variant={variant}
      role={label ? "status" : undefined}
    />
  );
}
