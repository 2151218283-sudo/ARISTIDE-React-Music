"use client";

import Link from "next/link";
import { useState } from "react";

import type { UserProfile } from "@/lib/music/models";

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
      title={`${user.nickname}的个人主页`}
    >
      {showImage ? (
        <img
          alt={`${user.nickname}的头像`}
          className={styles.image}
          onError={() => setImageFailed(true)}
          src={user.avatarUrl ?? undefined}
        />
      ) : (
        <span aria-label={`${user.nickname}的头像加载失败`} className={styles.fallback}>
          {getInitial(user.nickname)}
        </span>
      )}
    </Link>
  );
}
