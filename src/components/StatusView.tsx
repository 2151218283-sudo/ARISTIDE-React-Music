import {
  AlertCircle,
  Ban,
  CircleHelp,
  Inbox,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";

import { TextButton, type TextButtonVariant } from "./TextButton";
import styles from "./StatusView.module.css";

export type StatusViewTone =
  | "empty"
  | "error"
  | "unavailable"
  | "offline"
  | "info";
export type StatusViewVariant = "page" | "inline";

export interface StatusViewAction {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onClick: () => void;
  variant?: TextButtonVariant;
}

export interface StatusViewProps {
  action?: StatusViewAction;
  className?: string;
  description?: string;
  icon?: ReactNode;
  secondaryAction?: StatusViewAction;
  title: string;
  tone?: StatusViewTone;
  variant?: StatusViewVariant;
}

const statusIcons = {
  empty: Inbox,
  error: AlertCircle,
  unavailable: Ban,
  offline: WifiOff,
  info: CircleHelp,
};

function renderAction(action: StatusViewAction, fallbackVariant: TextButtonVariant) {
  return (
    <TextButton
      disabled={action.disabled}
      loading={action.loading}
      onClick={action.onClick}
      variant={action.variant ?? fallbackVariant}
    >
      {action.label}
    </TextButton>
  );
}

export function StatusView({
  action,
  className,
  description,
  icon,
  secondaryAction,
  title,
  tone = "info",
  variant = "inline",
}: StatusViewProps) {
  const DefaultIcon = statusIcons[tone];
  const classes = [styles.root, styles[variant], styles[tone], className]
    .filter(Boolean)
    .join(" ");
  const role = tone === "error" || tone === "unavailable"
    ? "alert"
    : "status";

  return (
    <section
      aria-atomic="true"
      className={classes}
      data-tone={tone}
      role={role}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <DefaultIcon strokeWidth={1.7} />}
      </span>
      <div className={styles.copy}>
        <h2 className={styles.title}>{title}</h2>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className={styles.actions}>
          {action ? renderAction(action, tone === "error" ? "primary" : "secondary") : null}
          {secondaryAction ? renderAction(secondaryAction, "quiet") : null}
        </div>
      ) : null}
    </section>
  );
}
