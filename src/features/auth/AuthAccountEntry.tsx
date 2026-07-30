"use client";

import { Ellipsis, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/IconButton";

import { AvatarButton } from "./AvatarButton";
import { BrandMark } from "./BrandMark";
import { QrLoginDialog } from "./QrLoginDialog";
import { useAuth } from "./AuthProvider";
import styles from "./AuthAccountEntry.module.css";

export function AuthAccountEntry() {
  const pathname = usePathname();
  const {
    closeLogin,
    completeLogin,
    loginOpen,
    logout,
    logoutLoading,
    openLogin,
    status,
    user,
  } = useAuth();
  const brandMarkRef = useRef<HTMLButtonElement>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        requestAnimationFrame(() => entryRef.current
          ?.querySelector<HTMLButtonElement>("[data-account-menu-trigger]")
          ?.focus());
      }
    };
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => document.removeEventListener("keydown", closeMenuOnEscape);
  }, [menuOpen]);

  const handleLogout = async () => {
    setLogoutFailed(false);
    const didLogout = await logout();
    if (didLogout) {
      setMenuOpen(false);
      return;
    }
    setLogoutFailed(true);
  };

  const dialog = (
    <QrLoginDialog
      onAuthorized={completeLogin}
      onClose={closeLogin}
      open={loginOpen}
      triggerRef={brandMarkRef}
    />
  );

  return (
    <div className={styles.entry} ref={entryRef}>
      {dialog}
      {!user ? (
        <BrandMark
          loading={status === "loading"}
          onClick={openLogin}
          ref={brandMarkRef}
        />
      ) : (
        <>
          <AvatarButton
            current={pathname === `/profile/${encodeURIComponent(user.id)}`}
            user={user}
          />
          <IconButton
            data-account-menu-trigger
            icon={<Ellipsis aria-hidden="true" strokeWidth={1.7} />}
            label="账号菜单"
            onClick={() => setMenuOpen((open) => !open)}
            pressed={menuOpen}
            size="md"
          />
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              <Link className={styles.menuItem} href="/settings" role="menuitem">
                <Settings aria-hidden="true" strokeWidth={1.7} />
                <span>设置</span>
              </Link>
              <button
                aria-busy={logoutLoading || undefined}
                className={styles.menuItem}
                disabled={logoutLoading}
                onClick={() => void handleLogout()}
                role="menuitem"
                type="button"
              >
                <LogOut aria-hidden="true" strokeWidth={1.7} />
                <span>{logoutLoading ? "正在退出" : "退出登录"}</span>
              </button>
              {logoutFailed ? <p role="alert">无法退出登录，请重试</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
