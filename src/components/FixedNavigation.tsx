"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AuthAccountEntry } from "@/features/auth/AuthAccountEntry";

import styles from "./FixedNavigation.module.css";

const ROUTE_CONTEXTS = [
  { label: "NOW PLAYING", pattern: /^\/track\/[^/]+\/?$/ },
  { label: "ALBUM", pattern: /^\/album\/[^/]+\/?$/ },
  { label: "ARTIST", pattern: /^\/artist\/[^/]+\/?$/ },
  { label: "PLAYLIST", pattern: /^\/playlist\/[^/]+\/?$/ },
  { label: "PROFILE", pattern: /^\/profile\/[^/]+\/?$/ },
] as const;

export function getNavigationContext(pathname: string): string {
  if (pathname === "/") {
    return "DAILY SIGNAL";
  }

  if (pathname === "/about") {
    return "ABOUT";
  }

  if (pathname === "/search") {
    return "SEARCH";
  }

  if (pathname === "/library") {
    return "LIBRARY";
  }

  if (pathname === "/settings") {
    return "SETTINGS";
  }

  return ROUTE_CONTEXTS.find(({ pattern }) => pattern.test(pathname))?.label
    ?? "ECHOFORM";
}

function currentAttribute(isCurrent: boolean): "page" | undefined {
  return isCurrent ? "page" : undefined;
}

interface FixedNavigationProps {
  onNavigate?: (path: string) => void;
}

export function FixedNavigation({ onNavigate }: FixedNavigationProps) {
  const pathname = usePathname();

  return (
    <nav className={styles.navigation} aria-label="ECHOFORM 主导航">
      <Link
        aria-current={currentAttribute(pathname === "/" || pathname === "/about")}
        aria-label="ECHOFORM 首页"
        className={styles.brand}
        href="/"
        onClick={() => onNavigate?.("/")}
      >
        ECHOFORM
      </Link>

      <p className={styles.context} data-route-context>
        {getNavigationContext(pathname)}
      </p>

      <div className={styles.actions}>
        <Link
          aria-current={currentAttribute(pathname === "/search")}
          aria-label="搜索"
          className={styles.iconLink}
          data-current={pathname === "/search"}
          href="/search"
          onClick={() => onNavigate?.("/search")}
          title="搜索"
        >
          <Search aria-hidden="true" strokeWidth={1.7} />
        </Link>
        <AuthAccountEntry />
      </div>
    </nav>
  );
}
