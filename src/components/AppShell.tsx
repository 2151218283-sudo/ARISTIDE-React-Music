"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

import { FixedNavigation } from "./FixedNavigation";
import { ProfileAvatarTransitionLayer } from "@/features/profile/ProfileAvatarTransitionLayer";
import styles from "./AppShell.module.css";

export type AppShellVariant =
  | "immersive-fixed"
  | "player-immersive"
  | "content-scroll";

const CONTENT_ROUTES = new Set(["/search", "/library", "/settings"]);
const CONTENT_ROUTE_PATTERNS = [
  /^\/album\/[^/]+\/?$/,
  /^\/artist\/[^/]+\/?$/,
  /^\/playlist\/[^/]+\/?$/,
  /^\/profile\/[^/]+\/?$/,
] as const;
const pageHeadingFocusStorageKey = "echoform:page-heading-focus";

export function getAppShellVariant(pathname: string): AppShellVariant | null {
  if (pathname === "/" || pathname === "/about") {
    return "immersive-fixed";
  }

  if (/^\/track\/[^/]+\/?$/.test(pathname)) {
    return "player-immersive";
  }

  if (
    CONTENT_ROUTES.has(pathname)
    || CONTENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
  ) {
    return "content-scroll";
  }

  return null;
}

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const variant = getAppShellVariant(pathname);
  const hasMountedRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  function requestPageHeadingFocus(path: string): void {
    window.sessionStorage.setItem(pageHeadingFocusStorageKey, path);
  }

  useLayoutEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (window.sessionStorage.getItem(pageHeadingFocusStorageKey) === pathname) {
      return;
    }

    const main = mainRef.current;
    const heading = main?.querySelector<HTMLElement>("[data-page-heading], h1");
    (heading ?? main)?.focus({ preventScroll: true });
  }, [pathname]);

  if (!variant) {
    return children;
  }

  const mainClassName = variant === "content-scroll"
    ? styles.contentMain
    : styles.immersiveMain;

  return (
    <div className={styles.root} data-shell={variant}>
      <a
        className={styles.skipLink}
        href="#main-content"
        onClick={() => mainRef.current?.focus()}
      >
        跳到主内容
      </a>
      <FixedNavigation onNavigate={requestPageHeadingFocus} />
      <main
        aria-label="ECHOFORM 主内容"
        className={mainClassName}
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
      >
        {children}
      </main>
      <ProfileAvatarTransitionLayer />
    </div>
  );
}
