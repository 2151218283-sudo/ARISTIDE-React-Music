"use client";

import Link from "next/link";
import { useState } from "react";

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
  const showImage = Boolean(user.avatarUrl) && !imageFailed;

  return (
    <Link
      aria-current={current ? "page" : undefined}
      aria-label={`${user.nickname}的个人主页`}
      className={styles.button}
      href={`/profile/${encodeURIComponent(user.id)}`}
      onClick={() => requestProfileAvatarTransition(user.id)}
      title={`${user.nickname}的个人主页`}
    >
      {showImage ? (
        <img
          alt={`${user.nickname}的头像`}
          className={styles.image}
          data-profile-avatar-id={user.id}
          onError={() => setImageFailed(true)}
          src={user.avatarUrl ?? undefined}
        />
      ) : (
        <span
          aria-label={`${user.nickname}的头像加载失败`}
          className={styles.fallback}
          data-profile-avatar-id={user.id}
        >
          {getInitial(user.nickname)}
        </span>
      )}
    </Link>
  );
}
