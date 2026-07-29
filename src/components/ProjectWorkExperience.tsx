"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectWork } from "@/types/projectWork";
import styles from "./ProjectWorkExperience.module.css";

const MEDIA_TRANSITION_DURATION = 900;
const WHEEL_INTERVAL = 520;
const BRAND_LETTERS = Array.from("ARISTIDE");
const SOCIAL_LINKS = [
  ["EMAIL", "mailto:aristide.benoist@gmail.com"],
  ["INSTAGRAM", "https://www.instagram.com/aristidebenoist"],
  ["TWITTER", "https://twitter.com/AristideBenoist"],
] as const;

interface ProjectWorkExperienceProps {
  project: ProjectWork;
}

export function ProjectWorkExperience({ project }: ProjectWorkExperienceProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const activeIndexRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);
  const lastWheelRef = useRef(0);

  const showMedia = useCallback(
    (nextIndex: number) => {
      const boundedIndex = Math.max(0, Math.min(project.media.length - 1, nextIndex));
      const currentIndex = activeIndexRef.current;

      if (boundedIndex === currentIndex) {
        return;
      }

      setDirection(boundedIndex > currentIndex ? 1 : -1);
      setPreviousIndex(currentIndex);

      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }

      transitionTimerRef.current = window.setTimeout(() => {
        setPreviousIndex(null);
        transitionTimerRef.current = null;
      }, MEDIA_TRANSITION_DURATION);

      activeIndexRef.current = boundedIndex;
      setActiveIndex(boundedIndex);
    },
    [project.media.length],
  );

  const moveMedia = useCallback(
    (step: number) => {
      showMedia(activeIndexRef.current + step);
    },
    [showMedia],
  );

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;

      if (delta === 0) {
        return;
      }

      event.preventDefault();
      const now = window.performance.now();

      if (now - lastWheelRef.current < WHEEL_INTERVAL) {
        return;
      }

      lastWheelRef.current = now;
      moveMedia(delta > 0 ? 1 : -1);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isNext = event.key === "ArrowDown"
        || event.key === "ArrowRight"
        || event.key === " ";
      const isPrevious = event.key === "ArrowUp" || event.key === "ArrowLeft";

      if (!isNext && !isPrevious) {
        return;
      }

      event.preventDefault();
      moveMedia(isNext ? 1 : -1);
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [moveMedia]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const activeMedia = project.media[activeIndex];
  const previousMedia = previousIndex === null
    ? null
    : project.media[previousIndex];
  const workStyle = {
    "--work-background": project.background,
    "--work-foreground": project.foreground,
  } as CSSProperties;

  return (
    <main className={styles.work} style={workStyle}>
      <nav className={styles.navigation} aria-label="Project navigation">
        <Link className={styles.brand} href="/" aria-label="Aristide Benoist home">
          {BRAND_LETTERS.map((letter, index) => (
            <span className={styles.brandClip} aria-hidden="true" key={`${letter}-${index}`}>
              <span style={{ "--item-delay": `${80 + index * 40}ms` } as CSSProperties}>
                {letter}
              </span>
            </span>
          ))}
        </Link>

        <Link className={styles.about} href="/about">ABOUT</Link>

        <Link className={styles.projectsLink} href="/">
          <span className={styles.closeIcon} aria-hidden="true" />
          <i aria-hidden="true" />
          <span>PROJECTS</span>
        </Link>

        {project.visitUrl ? (
          <a
            className={styles.visitLink}
            href={project.visitUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">{"\u2197"}</span>
            <i aria-hidden="true" />
            <b>VISIT SITE</b>
          </a>
        ) : null}

        <a className={styles.availability} href="mailto:aristide.benoist@gmail.com">
          <span>INDEPENDENT DEVELOPER</span>
          <span>AVAILABLE APR. 2023</span>
        </a>

        <div className={styles.socialLinks}>
          {SOCIAL_LINKS.map(([label, href]) => (
            <a
              href={href}
              key={label}
              target={href.startsWith("https://") ? "_blank" : undefined}
              rel={href.startsWith("https://") ? "noreferrer" : undefined}
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <h1 className={styles.title} aria-label={project.title}>
        {project.titleRows.map((row, rowIndex) => (
          <span className={styles.titleRow} key={`${row}-${rowIndex}`}>
            {Array.from(row).map((letter, letterIndex) => (
              <span className={styles.titleLetter} key={`${letter}-${letterIndex}`}>
                <span
                  style={{
                    "--item-delay": `${120 + (rowIndex * row.length + letterIndex) * 18}ms`,
                  } as CSSProperties}
                >
                  {letter === " " ? "\u00a0" : letter}
                </span>
              </span>
            ))}
          </span>
        ))}
      </h1>

      <section className={styles.mediaStage} aria-label={`${project.title} media gallery`}>
        {previousMedia ? (
          <div
            className={styles.mediaLayer}
            data-state="previous"
            data-direction={direction}
            key={`previous-${previousIndex}`}
          >
            <Image
              src={previousMedia.large}
              alt=""
              fill
              sizes="(max-width: 700px) calc(100vw - 40px), 96vh"
              unoptimized
            />
          </div>
        ) : null}

        <div
          className={styles.mediaLayer}
          data-state="active"
          data-direction={direction}
          key={`active-${activeIndex}`}
        >
          <Image
            src={activeMedia.large}
            alt={`${project.title}, image ${activeIndex + 1} of ${project.media.length}`}
            fill
            loading={activeIndex === 0 ? "eager" : "lazy"}
            sizes="(max-width: 700px) calc(100vw - 40px), 96vh"
            unoptimized
          />
        </div>
      </section>

      <div className={styles.thumbnailRail} aria-label="Select project image">
        <span
          className={styles.railIndicator}
          style={{ "--active-slot": activeMedia.slot } as CSSProperties}
          aria-hidden="true"
        />
        {project.media.map((media, index) => (
          <button
            className={styles.thumbnail}
            data-active={index === activeIndex}
            type="button"
            onClick={() => showMedia(index)}
            aria-label={`Show image ${index + 1} of ${project.media.length}`}
            aria-pressed={index === activeIndex}
            key={media.thumbnail}
            style={{
              "--media-slot": media.slot,
              "--item-delay": `${400 + index * 80}ms`,
            } as CSSProperties}
          >
            <Image src={media.thumbnail} alt="" fill sizes="9vh" unoptimized />
          </button>
        ))}
      </div>

      <div className={styles.mobileSelector} aria-label="Select project image">
        {project.media.map((media, index) => (
          <button
            type="button"
            data-active={index === activeIndex}
            onClick={() => showMedia(index)}
            aria-label={`Show image ${index + 1} of ${project.media.length}`}
            aria-pressed={index === activeIndex}
            key={media.thumbnail}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>

      <p className={styles.mediaStatus} aria-live="polite">
        Image {activeIndex + 1} of {project.media.length}
      </p>
    </main>
  );
}
