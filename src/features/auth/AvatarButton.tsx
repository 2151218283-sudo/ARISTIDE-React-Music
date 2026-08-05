"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState, type MouseEvent } from "react";

import type { UserProfile } from "@/lib/music/models";
import { requestProfileAvatarTransition } from "@/features/profile/profileAvatarTransition";

import styles from "./AvatarButton.module.css";

interface AvatarButtonProps {
  current?: boolean;
  user: UserProfile;
}

function getInitial(nickname: string): string {
  return Array.from(nickname.trim())[0] ?? "?";
}

export function AvatarButton({ current = false, user }: AvatarButtonProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarElementRef = useRef<HTMLElement | null>(null);
  const showImage = Boolean(user.avatarUrl) && !imageFailed;

  const requestTransition = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (
      event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const avatarElement = avatarElementRef.current;
    if (!avatarElement) {
      return;
    }

    const bounds = avatarElement.getBoundingClientRect();
    requestProfileAvatarTransition({
      avatar: {
        avatarUrl: user.avatarUrl,
        nickname: user.nickname,
        useFallback: !showImage,
      },
      source: {
        height: bounds.height,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
      },
      userId: user.id,
    });
  };

  return (
    <Link
      aria-current={current ? "page" : undefined}
      aria-label={`${user.nickname}的个人主页`}
      className={styles.button}
      href={`/profile/${encodeURIComponent(user.id)}`}
      onClick={requestTransition}
      title={`${user.nickname}的个人主页`}
    >
      {showImage ? (
        <Image
          alt={`${user.nickname}的头像`}
          className={styles.image}
          data-profile-avatar-id={user.id}
          height={36}
          onError={() => setImageFailed(true)}
          ref={(element) => {
            avatarElementRef.current = element;
          }}
          src={user.avatarUrl ?? ""}
          unoptimized
          width={36}
        />
      ) : (
        <span
          aria-label={`${user.nickname}的头像加载失败`}
          className={styles.fallback}
          data-profile-avatar-id={user.id}
          ref={(element) => {
            avatarElementRef.current = element;
          }}
        >
          {getInitial(user.nickname)}
        </span>
      )}
    </Link>
  );
}
