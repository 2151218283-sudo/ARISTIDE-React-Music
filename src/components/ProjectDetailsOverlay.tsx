"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

import type { Project } from "@/types/project";
import styles from "./ProjectDetailsOverlay.module.css";

interface ProjectDetailsOverlayProps {
  accent?: string;
  phase: ProjectDetailsPhase;
  project: Project | null;
  onClose: () => void;
}

export type ProjectDetailsPhase = "hidden" | "entering" | "visible" | "exiting";

export function ProjectDetailsOverlay({
  accent,
  phase,
  project,
  onClose,
}: ProjectDetailsOverlayProps) {
  const overlayStyle = accent
    ? ({ "--project-accent": accent } as CSSProperties)
    : undefined;

  return (
    <aside
      className={styles.overlay}
      data-phase={phase}
      style={overlayStyle}
      aria-hidden={phase === "hidden"}
    >
      {project ? (
        <>
          <button
            className={styles.counter}
            type="button"
            onClick={onClose}
            disabled={phase === "exiting"}
            aria-label={`Project ${project.number} of ${project.total}; back to projects`}
          >
            <span>{project.number}</span>
            <i aria-hidden="true" />
            <span>{project.total}</span>
          </button>

          <h2 className={styles.title}>
            {project.titleRows.map((row, rowIndex) => (
              <span className={styles.titleRow} key={`${row}-${rowIndex}`}>
                {Array.from(row).map((letter, letterIndex) => (
                  <span
                    className={styles.titleLetter}
                    key={`${letter}-${letterIndex}`}
                    style={{
                      "--letter-delay": `${(rowIndex * row.length + letterIndex) * 12}ms`,
                    } as CSSProperties}
                  >
                    <span>{letter === " " ? "\u00a0" : letter}</span>
                  </span>
                ))}
              </span>
            ))}
          </h2>

          <dl className={styles.metadata}>
            {project.metadata.map((item) => (
              <div className={styles.metadataRow} key={item.key}>
                <dt>
                  <span>{item.key}</span>
                  <span>{item.label}</span>
                </dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>

          <p className={styles.description}>
            {project.description.map((line) => (
              <span className={styles.descriptionLine} key={line}>
                <span>{line}</span>
              </span>
            ))}
          </p>

          <Link className={styles.explore} href={`/${project.slug}`}>
            <span>EXPLORE</span>
            <i aria-hidden="true" />
            <b aria-hidden="true">+</b>
          </Link>
        </>
      ) : null}
    </aside>
  );
}
