import type { CSSProperties } from "react";

import styles from "./AboutPanel.module.css";

const BIOGRAPHY =
  "ARISTIDE BENOIST IS A DEVELOPER WHO SPECIALIZES IN MOTION AND INTERACTION. AS AN INDEPENDENT, HE WORKS WITH COMPANIES, AGENCIES, STARTUPS AND INDIVIDUALS ALL OVER THE WORLD.";

const BIOGRAPHY_LINES = [
  "ARISTIDE BENOIST IS A DEVELOPER WHO SPECIALIZES IN",
  "MOTION AND INTERACTION. AS AN INDEPENDENT, HE WORKS",
  "WITH COMPANIES, AGENCIES, STARTUPS AND INDIVIDUALS",
  "ALL OVER THE WORLD.",
] as const;

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
  {
    label: "BEHANCE",
    href: "https://www.behance.net/aristidebenoist",
    ariaLabel: "Aristide Benoist on Behance (opens in a new tab)",
  },
  {
    label: "DRIBBBLE",
    href: "https://dribbble.com/aristidebenoist",
    ariaLabel: "Aristide Benoist on Dribbble (opens in a new tab)",
  },
  {
    label: "LINKEDIN",
    href: "https://www.linkedin.com/in/aristidebenoist",
    ariaLabel: "Aristide Benoist on LinkedIn (opens in a new tab)",
  },
  {
    label: "GITHUB",
    href: "https://github.com/aristidebenoist",
    ariaLabel: "Aristide Benoist on GitHub (opens in a new tab)",
  },
] as const;

const CLIENTS = [
  ["A", 44],
  ["BEAR GRYLLS", 55],
  ["DRIBBBLE", 77],
  ["FUSE PROJECT", 99],
  ["GOOGLE", 110],
  ["HIMS & HERS", 121],
  ["INSTAGRAM", 132],
  ["JACQUES MARIE MAGE", 143],
  ["MGM STUDIOS", 176],
  ["NETFLIX", 187],
  ["OBAMA FOUNDATION", 198],
  ["RAPPI", 231],
  ["SUPER FRIENDLY", 242],
  ["TWITCH", 253],
  ["WATSON DG", 286],
  ["Z", 319],
] as const;

const AWWWARDS = [
  ["2", "INDEPENDENT OF THE YEAR", 66],
  ["3", "SITE OF THE MONTH", 77],
  ["30", "SITE OF THE DAY", 374],
  ["27", "DEVELOPER AWARD", 341],
  ["6", "MOBILE OF THE WEEK", 110],
  ["22", "MOBILE EXCELLENCE", 286],
] as const;

const FWA_AWARDS = [
  ["1", "FWA OF THE MONTH", 55],
  ["2", "FWAWWWARD", 66],
  ["22", "FWA OF THE DAY", 286],
] as const;

const BEHANCE_AWARDS = [
  ["1", "GRAPHIC DESIGN", 55],
  ["7", "GALLERY", 121],
  ["11", "INTERACTION", 165],
] as const;

const COLUMN_MARKERS = [44, 154, 264, 374] as const;

export interface AboutPanelProps {
  isOpen: boolean;
}

interface AwardColumnProps {
  title: string;
  awards: ReadonlyArray<readonly [count: string, label: string, top: number]>;
  markerCount: number;
}

function rowPosition(top: number): CSSProperties {
  return { "--row-top": `${top}px` } as CSSProperties;
}

function DisplayLine({ text }: { text: string }) {
  return (
    <div className={styles.displayLine} aria-hidden="true">
      {Array.from(text).map((character, index) => (
        <span className={styles.displayLetterClip} key={`${character}-${index}`}>
          <span className={styles.displayLetter}>{character}</span>
        </span>
      ))}
    </div>
  );
}

function AwardColumn({ title, awards, markerCount }: AwardColumnProps) {
  return (
    <li className={styles.infoColumn}>
      <div className={styles.rowClip}>
        <div className={`${styles.revealRow} ${styles.columnTitle}`}>{title}</div>
      </div>
      <div className={styles.awardRows}>
        {awards.map(([count, label, top]) => (
          <div
            className={styles.rowClip}
            key={`${count}-${label}`}
            style={rowPosition(top)}
          >
            <div className={`${styles.revealRow} ${styles.awardRow}`}>
              <span className={styles.awardCount}>{count}</span>
              <span>{label}</span>
            </div>
          </div>
        ))}
        {COLUMN_MARKERS.slice(0, markerCount).map((top, index) => (
          <div
            className={`${styles.rowClip} ${styles.scaleMarker}`}
            key={`${title}-marker-${index}`}
            style={rowPosition(top)}
            aria-hidden="true"
          >
            <div className={styles.revealRow}>{index}</div>
          </div>
        ))}
      </div>
    </li>
  );
}

export function AboutPanel({ isOpen }: AboutPanelProps) {
  const panelClassName = `${styles.panel} ${
    isOpen ? styles.panelOpen : styles.panelClosed
  }`;

  return (
    <section
      className={panelClassName}
      aria-label="About Aristide Benoist"
      aria-hidden={!isOpen}
    >
      <div className={styles.leftContent}>
        <div className={styles.display} aria-label="ESY68 33098L">
          <DisplayLine text="ESY68" />
          <DisplayLine text="33098L" />
        </div>

        <p className={styles.biography} aria-label={BIOGRAPHY}>
          {BIOGRAPHY_LINES.map((line, index) => (
            <span className={styles.rowClip} aria-hidden="true" key={line}>
              <span className={styles.revealRow}>
                {line}
                {index < BIOGRAPHY_LINES.length - 1 ? " " : null}
              </span>
            </span>
          ))}
        </p>
      </div>

      <nav className={styles.socialLinks} aria-label="About social links">
        {SOCIAL_LINKS.map((link) => {
          const isExternal = link.href.startsWith("https://");

          return (
            <span className={styles.rowClip} key={link.label}>
              <a
                className={`${styles.revealRow} ${styles.socialLink}`}
                href={link.href}
                aria-label={link.ariaLabel}
                rel={isExternal ? "noreferrer" : undefined}
                target={isExternal ? "_blank" : undefined}
                tabIndex={isOpen ? 0 : -1}
              >
                <span>{link.label}</span>
                <span className={styles.linkArrow} aria-hidden="true">
                  {"\u2197"}
                </span>
              </a>
            </span>
          );
        })}
      </nav>

      <ul className={styles.infoColumns} aria-label="Selected clients and awards">
        <li className={styles.infoColumn}>
          <div className={styles.rowClip}>
            <div className={`${styles.revealRow} ${styles.columnTitle}`}>CLIENTS</div>
          </div>
          <div className={styles.clientRows}>
            {CLIENTS.map(([client, top]) => (
              <div
                className={styles.rowClip}
                key={client}
                style={rowPosition(top)}
              >
                <div className={styles.revealRow}>{client}</div>
              </div>
            ))}
          </div>
        </li>
        <AwardColumn title="AWWWARDS" awards={AWWWARDS} markerCount={3} />
        <AwardColumn title="FWA" awards={FWA_AWARDS} markerCount={4} />
        <AwardColumn title="BEHANCE" awards={BEHANCE_AWARDS} markerCount={4} />
      </ul>

      <div className={styles.credit}>
        <div className={styles.rowClip}>
          <a
            className={`${styles.revealRow} ${styles.creditLink}`}
            href="https://www.jonway.studio"
            aria-label="Design by JW.S, Jon Way Studio (opens in a new tab)"
            rel="noreferrer"
            target="_blank"
            tabIndex={isOpen ? 0 : -1}
          >
            DESIGN BY JW.S (JON WAY STUDIO)
            <span className={styles.linkArrow} aria-hidden="true">
              {"\u2197"}
            </span>
          </a>
        </div>
      </div>

      <div className={styles.rights}>
        <div className={styles.rowClip}>
          <div className={styles.revealRow}>ALL RIGHTS RESERVED</div>
        </div>
        <div className={styles.rowClip}>
          <div className={styles.revealRow}>ARISTIDE BENOIST 2026&reg;</div>
        </div>
      </div>
    </section>
  );
}
