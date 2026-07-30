"use client";

import { useLayoutEffect, useRef } from "react";

import { StatusView } from "./StatusView";
import styles from "./RoutePlaceholder.module.css";

const pageHeadingFocusStorageKey = "echoform:page-heading-focus";

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
  const headingRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const requestedPath = window.sessionStorage.getItem(pageHeadingFocusStorageKey);
    let requestedBySameOriginNavigation = false;
    try {
      requestedBySameOriginNavigation = Boolean(document.referrer)
        && new URL(document.referrer).origin === window.location.origin;
    } catch {
      requestedBySameOriginNavigation = false;
    }

    if (
      requestedPath !== window.location.pathname
      && !requestedBySameOriginNavigation
    ) {
      return;
    }

    if (requestedPath === window.location.pathname) {
      window.sessionStorage.removeItem(pageHeadingFocusStorageKey);
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1
          className={styles.heading}
          data-page-heading
          ref={headingRef}
          tabIndex={-1}
        >
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
