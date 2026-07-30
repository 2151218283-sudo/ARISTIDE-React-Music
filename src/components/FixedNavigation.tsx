"use client";

import { Search, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function FixedNavigation() {
  const pathname = usePathname();
  const accountIsCurrent = pathname === "/settings"
    || pathname.startsWith("/profile/");

  return (
    <nav className={styles.navigation} aria-label="ECHOFORM 主导航">
      <Link
        aria-current={currentAttribute(pathname === "/" || pathname === "/about")}
        aria-label="ECHOFORM 首页"
        className={styles.brand}
        href="/"
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
          title="搜索"
        >
          <Search aria-hidden="true" strokeWidth={1.7} />
        </Link>
        <Link
          aria-current={currentAttribute(accountIsCurrent)}
          aria-label="账号与设置"
          className={styles.iconLink}
          data-current={accountIsCurrent}
          href="/settings"
          title="账号与设置"
        >
          <UserRound aria-hidden="true" strokeWidth={1.7} />
        </Link>
      </div>
    </nav>
  );
}
