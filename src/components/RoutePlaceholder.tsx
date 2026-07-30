import { StatusView } from "./StatusView";
import styles from "./RoutePlaceholder.module.css";

interface RoutePlaceholderProps {
  description: string;
  eyebrow: string;
  statusDescription: string;
  title: string;
}

export function RoutePlaceholder({
  description,
  eyebrow,
  statusDescription,
  title,
}: RoutePlaceholderProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.heading} data-page-heading tabIndex={-1}>
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
      </header>
      <StatusView
        description={statusDescription}
        title="模块正在搭建"
        tone="info"
        variant="page"
      />
    </div>
  );
}
