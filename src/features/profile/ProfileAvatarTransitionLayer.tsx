"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  completeProfileAvatarTransition,
  type ProfileAvatarTransitionBounds,
  type ProfileAvatarTransitionRequest,
  useProfileAvatarTransitionSnapshot,
} from "./profileAvatarTransition";

import styles from "./ProfileAvatarTransitionLayer.module.css";

interface ActiveProfileAvatarTransition {
  end: ProfileAvatarTransitionBounds;
  request: ProfileAvatarTransitionRequest;
  started: boolean;
}

function getBounds(element: HTMLElement): ProfileAvatarTransitionBounds {
  const rect = element.getBoundingClientRect();
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

function transitionStyle(transition: ActiveProfileAvatarTransition): CSSProperties {
  const { end, request } = transition;
  const { source } = request;
  const scaleX = Math.max(1, end.width) / Math.max(1, source.width);
  const scaleY = Math.max(1, end.height) / Math.max(1, source.height);

  return {
    height: `${source.height}px`,
    left: `${source.left}px`,
    top: `${source.top}px`,
    transform: transition.started
      ? `translate3d(${end.left - source.left}px, ${end.top - source.top}px, 0) scale(${scaleX}, ${scaleY})`
      : "translate3d(0, 0, 0) scale(1)",
    transformOrigin: "top left",
    width: `${source.width}px`,
  };
}

function getInitial(nickname: string): string {
  return Array.from(nickname.trim())[0] ?? "?";
}

export function ProfileAvatarTransitionLayer() {
  const snapshot = useProfileAvatarTransitionSnapshot();
  const [activeTransition, setActiveTransition] = useState<ActiveProfileAvatarTransition | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const pendingStartIdRef = useRef<number | null>(null);

  const finish = useCallback((transitionId: number): void => {
    if (activeIdRef.current !== transitionId) {
      return;
    }
    activeIdRef.current = null;
    setActiveTransition(null);
    completeProfileAvatarTransition(transitionId);
  }, []);

  useLayoutEffect(() => {
    const request = snapshot.request;
    const target = snapshot.target;
    if (
      !request
      || !target
      || activeIdRef.current === request.id
      || pendingStartIdRef.current === request.id
    ) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      completeProfileAvatarTransition(request.id);
      return;
    }

    pendingStartIdRef.current = request.id;
    const frameId = window.requestAnimationFrame(() => {
      pendingStartIdRef.current = null;
      activeIdRef.current = request.id;
      setActiveTransition({
        end: getBounds(target),
        request,
        started: false,
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (pendingStartIdRef.current === request.id) {
        pendingStartIdRef.current = null;
      }
    };
  }, [snapshot.request, snapshot.target]);

  const activeTransitionId = activeTransition?.request.id ?? null;

  useEffect(() => {
    if (activeTransitionId === null) {
      return;
    }

    const transitionId = activeTransitionId;
    const frameId = window.requestAnimationFrame(() => {
      setActiveTransition((current) => current?.request.id === transitionId
        ? { ...current, started: true }
        : current);
    });
    const fallbackId = window.setTimeout(() => finish(transitionId), 760);
    const cancel = (): void => finish(transitionId);
    const events = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
    events.forEach((event) => window.addEventListener(event, cancel, { capture: true, once: true }));

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(fallbackId);
      events.forEach((event) => window.removeEventListener(event, cancel, { capture: true }));
    };
  }, [activeTransitionId, finish]);

  if (!activeTransition) {
    return null;
  }

  const { avatar } = activeTransition.request;
  return (
    <span
      aria-hidden="true"
      className={styles.clone}
      data-profile-avatar-transition-clone
      data-running={activeTransition.started || undefined}
      onTransitionEnd={(event) => {
        if (event.propertyName === "transform") {
          finish(activeTransition.request.id);
        }
      }}
      style={transitionStyle(activeTransition)}
    >
      {avatar.avatarUrl && !avatar.useFallback ? (
        <Image alt="" className={styles.image} fill sizes="180px" src={avatar.avatarUrl} unoptimized />
      ) : (
        <span className={styles.fallback}>{getInitial(avatar.nickname)}</span>
      )}
    </span>
  );
}
