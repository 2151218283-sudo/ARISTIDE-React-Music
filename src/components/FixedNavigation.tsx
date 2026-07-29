"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

import styles from "./FixedNavigation.module.css";

const BRAND_LETTERS = Array.from("ARISTIDE");

const SOCIAL_LINKS = [
  {
    label: "EMAIL",
    href: "mailto:aristide.benoist@gmail.com",
    ariaLabel: "Email Aristide Benoist",
  },
  {
    label: "INSTAGRAM",
    href: "https://www.instagram.com/aristidebenoist",
    ariaLabel: "Aristide Benoist on Instagram (opens in a new tab)",
  },
  {
    label: "TWITTER",
    href: "https://twitter.com/AristideBenoist",
    ariaLabel: "Aristide Benoist on Twitter (opens in a new tab)",
  },
] as const;

export interface FixedNavigationProps {
  accent?: string;
  isAbout: boolean;
  onAbout(): void;
  onClose(): void;
}

export function FixedNavigation({
  accent,
  isAbout,
  onAbout,
  onClose,
}: FixedNavigationProps) {
  const navigationStyle = accent
    ? ({ "--navigation-color": accent } as CSSProperties)
    : undefined;

  return (
    <nav
      className={styles.navigation}
      data-about={isAbout}
      style={navigationStyle}
      aria-label="Primary navigation"
    >
      <Link className={styles.brand} href="/" aria-label="Aristide Benoist home">
        {BRAND_LETTERS.map((letter, index) => (
          <span className={styles.brandLetterClip} aria-hidden="true" key={`${letter}-${index}`}>
            <span className={styles.brandLetter}>{letter}</span>
          </span>
        ))}
      </Link>

      <div className={styles.modeSwitch} role="group" aria-label="About panel controls">
        <button
          className={`${styles.modeButton} ${
            isAbout ? styles.aboutInactive : styles.modeActive
          }`}
          type="button"
          onClick={onAbout}
          disabled={isAbout}
          aria-hidden={isAbout}
          aria-label="Open about panel"
        >
          <span className={styles.linkReveal}>ABOUT</span>
        </button>
        <button
          className={`${styles.modeButton} ${
            isAbout ? styles.modeActive : styles.closeInactive
          }`}
          type="button"
          onClick={onClose}
          disabled={!isAbout}
          aria-hidden={!isAbout}
          aria-label="Close about panel"
        >
          <span className={styles.linkReveal}>CLOSE</span>
        </button>
      </div>

      <a
        className={styles.availability}
        href="mailto:aristide.benoist@gmail.com"
        aria-label="Email Aristide Benoist, independent developer, available April 2023"
      >
        <span className={styles.availabilityLineClip}>
          <span className={styles.linkReveal}>INDEPENDENT DEVELOPER</span>
        </span>
        <span className={styles.availabilityLineClip}>
          <span className={styles.linkReveal}>AVAILABLE APR. 2023</span>
        </span>
      </a>

      <div className={styles.socialLinks} role="group" aria-label="Social links">
        {SOCIAL_LINKS.map((link) => {
          const isExternal = link.href.startsWith("https://");

          return (
            <a
              className={styles.socialLink}
              href={link.href}
              aria-label={link.ariaLabel}
              key={link.label}
              rel={isExternal ? "noreferrer" : undefined}
              target={isExternal ? "_blank" : undefined}
            >
              <span className={styles.socialLineClip}>
                <span className={`${styles.linkReveal} ${styles.socialRow}`}>
                  <span className={styles.socialArrow} aria-hidden="true">
                    {"\u2197"}
                  </span>
                  <span>{link.label}</span>
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
