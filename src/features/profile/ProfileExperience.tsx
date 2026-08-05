"use client";

import { ArrowLeft, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { PlaylistTile } from "@/components/PlaylistTile";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import type {
  UserPlaylistCollection,
  UserProfile,
  UserProfileOverview,
} from "@/lib/music/models";

import { consumeProfileAvatarTransition } from "./profileAvatarTransition";
import {
  ProfileClientError,
  requestUserPlaylists,
  requestUserProfile,
} from "./profileClient";
import styles from "./ProfileExperience.module.css";

interface ProfileExperienceProps {
  userId: string;
}

interface ProfileFailure {
  code: string;
  message: string;
  retryable: boolean;
}

interface AvatarTransitionPosition {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface AvatarTransitionState {
  end: AvatarTransitionPosition;
  profile: UserProfile;
  start: AvatarTransitionPosition;
  started: boolean;
}

function getInitial(nickname: string): string {
  return Array.from(nickname.trim())[0] ?? "?";
}

function toFailure(error: unknown): ProfileFailure {
  if (error instanceof ProfileClientError) {
    return error;
  }
  return {
    code: "NETWORK_ERROR",
    message: "无法连接用户主页服务，请稍后重试。",
    retryable: true,
  };
}

function positionFor(element: HTMLElement): AvatarTransitionPosition {
  const rect = element.getBoundingClientRect();
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

function transitionStyle(
  transition: AvatarTransitionState,
): CSSProperties {
  const deltaX = transition.end.left - transition.start.left;
  const deltaY = transition.end.top - transition.start.top;
  const scaleX = Math.max(1, transition.end.width) / Math.max(1, transition.start.width);
  const scaleY = Math.max(1, transition.end.height) / Math.max(1, transition.start.height);
  return {
    height: `${transition.start.height}px`,
    left: `${transition.start.left}px`,
    top: `${transition.start.top}px`,
    transform: transition.started
      ? `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`
      : "translate3d(0, 0, 0) scale(1)",
    transformOrigin: "top left",
    width: `${transition.start.width}px`,
  };
}

function Avatar({
  avatarRef,
  profile,
}: {
  avatarRef: React.RefObject<HTMLDivElement | null>;
  profile: UserProfile;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(profile.avatarUrl) && !imageFailed;

  return (
    <div
      aria-label={`${profile.nickname}的头像`}
      className={styles.avatar}
      data-profile-header-avatar
      ref={avatarRef}
      role="img"
    >
      {showImage ? (
        <Image
          alt=""
          className={styles.avatarImage}
          fill
          onError={() => setImageFailed(true)}
          sizes="180px"
          src={profile.avatarUrl ?? ""}
          unoptimized
        />
      ) : (
        <span aria-label={`${profile.nickname}的头像加载失败`} className={styles.avatarFallback}>
          {getInitial(profile.nickname)}
        </span>
      )}
    </div>
  );
}

function ProfileAvatarTransition({
  profile,
  targetRef,
}: {
  profile: UserProfile;
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [transition, setTransition] = useState<AvatarTransitionState | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const transitionRequestedRef = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    if (transitionRequestedRef.current === null) {
      transitionRequestedRef.current = consumeProfileAvatarTransition(profile.id);
    }
    if (!transitionRequestedRef.current) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const source = [...document.querySelectorAll<HTMLElement>("[data-profile-avatar-id]")]
      .find((element) => element.dataset.profileAvatarId === profile.id);
    const target = targetRef.current;
    if (!source || !target) {
      return;
    }

    const start = positionFor(source);
    const end = positionFor(target);
    setImageFailed(false);
    setTransition({ end, profile, start, started: false });
    const frameId = window.requestAnimationFrame(() => {
      setTransition((current) => current ? { ...current, started: true } : current);
    });
    const completeId = window.setTimeout(() => setTransition(null), 620);
    const cancel = (): void => setTransition(null);
    const events = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
    events.forEach((event) => window.addEventListener(event, cancel, { capture: true, once: true }));

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(completeId);
      events.forEach((event) => window.removeEventListener(event, cancel, { capture: true }));
    };
  }, [profile, targetRef]);

  if (!transition) {
    return null;
  }

  const showImage = Boolean(transition.profile.avatarUrl) && !imageFailed;
  return (
    <span
      aria-hidden="true"
      className={styles.avatarTransition}
      data-running={transition.started || undefined}
      style={transitionStyle(transition)}
    >
      {showImage ? (
        <Image
          alt=""
          className={styles.avatarImage}
          fill
          onError={() => setImageFailed(true)}
          sizes="180px"
          src={transition.profile.avatarUrl ?? ""}
          unoptimized
        />
      ) : <span className={styles.avatarFallback}>{getInitial(transition.profile.nickname)}</span>}
    </span>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-label="正在加载用户主页" className={styles.skeleton} role="status">
      <Skeleton className={styles.skeletonAvatar} variant="artwork" />
      <div className={styles.skeletonCopy}>
        <Skeleton variant="line-short" />
        <Skeleton variant="line" />
        <Skeleton variant="line-short" />
      </div>
      <div className={styles.skeletonGrid}>
        <Skeleton variant="artwork" />
        <Skeleton variant="artwork" />
        <Skeleton variant="artwork" />
      </div>
    </div>
  );
}

function PlaylistGrid({
  emptyMessage,
  playlists,
}: {
  emptyMessage: string;
  playlists: ReadonlyArray<UserPlaylistCollection["created"][number]>;
}) {
  if (playlists.length === 0) {
    return <p className={styles.emptyMessage}>{emptyMessage}</p>;
  }
  return (
    <div className={styles.playlistGrid}>
      {playlists.map((playlist) => <PlaylistTile key={playlist.id} playlist={playlist} />)}
    </div>
  );
}

function CollectionSkeleton() {
  return (
    <div aria-label="正在加载用户歌单" className={styles.collectionSkeleton} role="status">
      <Skeleton variant="artwork" />
      <Skeleton variant="artwork" />
      <Skeleton variant="artwork" />
    </div>
  );
}

function ProfileCollections({
  collection,
  failure,
  isLoading,
  onRetry,
}: {
  collection: UserPlaylistCollection | null;
  failure: ProfileFailure | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  if (!collection && isLoading) {
    return <CollectionSkeleton />;
  }

  if (!collection && failure) {
    const protectedCollection = failure.code === "AUTH_REQUIRED"
      || failure.code === "SESSION_EXPIRED";
    return (
      <StatusView
        action={failure.retryable ? { label: "重试", onClick: onRetry } : undefined}
        description={protectedCollection
          ? "该用户未公开歌单，或当前账号没有查看权限。"
          : failure.message}
        title={protectedCollection ? "歌单未公开" : "无法加载用户歌单"}
        tone={protectedCollection ? "unavailable" : "error"}
      />
    );
  }

  if (!collection) {
    return null;
  }

  return (
    <div className={styles.collections}>
      <section aria-labelledby="profile-liked-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="profile-liked-heading">喜欢的音乐</h2>
        </div>
        {collection.liked ? (
          <div className={styles.likedGrid}>
            <PlaylistTile playlist={collection.liked} />
          </div>
        ) : <p className={styles.emptyMessage}>暂时没有可公开展示的喜欢音乐。</p>}
      </section>
      <section aria-labelledby="profile-created-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="profile-created-heading">创建的歌单</h2>
          <span>{collection.created.length} 个</span>
        </div>
        <PlaylistGrid emptyMessage="暂时没有可展示的创建歌单。" playlists={collection.created} />
      </section>
      <section aria-labelledby="profile-subscribed-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="profile-subscribed-heading">收藏的歌单</h2>
          <span>{collection.subscribed.length} 个</span>
        </div>
        <PlaylistGrid emptyMessage="暂时没有可展示的收藏歌单。" playlists={collection.subscribed} />
      </section>
    </div>
  );
}

export function ProfileExperience({ userId }: ProfileExperienceProps) {
  const router = useRouter();
  const avatarRef = useRef<HTMLDivElement>(null);
  const [overview, setOverview] = useState<UserProfileOverview | null>(null);
  const [collection, setCollection] = useState<UserPlaylistCollection | null>(null);
  const [profileFailure, setProfileFailure] = useState<ProfileFailure | null>(null);
  const [collectionFailure, setCollectionFailure] = useState<ProfileFailure | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isCollectionLoading, setIsCollectionLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [revision, setRevision] = useState(0);
  const [collectionRevision, setCollectionRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => setShowSkeleton(true), 300);

    void requestUserProfile(userId, controller.signal)
      .then((nextOverview) => {
        if (!controller.signal.aborted) {
          setOverview(nextOverview);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProfileFailure(toFailure(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsProfileLoading(false);
          window.clearTimeout(timer);
        }
      });

    void requestUserPlaylists(userId, controller.signal)
      .then((nextCollection) => {
        if (!controller.signal.aborted) {
          setCollection(nextCollection);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCollectionFailure(toFailure(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsCollectionLoading(false);
        }
      });

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [revision, userId]);

  useEffect(() => {
    if (collectionRevision === 0) {
      return;
    }
    const controller = new AbortController();
    void requestUserPlaylists(userId, controller.signal)
      .then((nextCollection) => {
        if (!controller.signal.aborted) {
          setCollection(nextCollection);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCollectionFailure(toFailure(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsCollectionLoading(false);
        }
      });
    return () => controller.abort();
  }, [collectionRevision, userId]);

  const retryProfile = (): void => {
    setShowSkeleton(false);
    setOverview(null);
    setCollection(null);
    setProfileFailure(null);
    setCollectionFailure(null);
    setIsProfileLoading(true);
    setIsCollectionLoading(true);
    setRevision((current) => current + 1);
    setCollectionRevision(0);
  };

  const retryCollections = (): void => {
    setCollectionFailure(null);
    setIsCollectionLoading(true);
    setCollectionRevision((current) => current + 1);
  };

  if (!overview && isProfileLoading && !showSkeleton) {
    return <div aria-busy="true" className={styles.pending} />;
  }

  if (!overview && isProfileLoading && showSkeleton) {
    return <ProfileSkeleton />;
  }

  if (!overview) {
    const missing = profileFailure?.code === "USER_NOT_FOUND";
    return (
      <div className={styles.statusPage}>
        <StatusView
          action={profileFailure?.retryable ? { label: "重试", onClick: retryProfile } : undefined}
          description={missing
            ? "这个链接指向的公开用户不存在，或暂时无法读取。"
            : profileFailure?.message ?? "用户主页暂时无法加载。"}
          secondaryAction={{ label: "返回首页", onClick: () => router.push("/") }}
          title={missing ? "未找到用户" : "无法加载用户主页"}
          tone={missing ? "empty" : "error"}
          variant="page"
        />
      </div>
    );
  }

  return (
    <main className={styles.page} data-profile-page>
      <Link className={styles.backLink} href="/"><ArrowLeft aria-hidden="true" />返回每日推荐</Link>
      <header className={styles.header}>
        <Avatar avatarRef={avatarRef} profile={overview.profile} />
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{overview.isCurrentUser ? "YOUR PROFILE" : "PUBLIC PROFILE"}</p>
          <h1 data-page-heading tabIndex={-1}>{overview.profile.nickname}</h1>
          {overview.profile.signature ? <p className={styles.signature}>{overview.profile.signature}</p> : null}
          {overview.isCurrentUser ? (
            <Link aria-label="打开个人设置" className={styles.settingsLink} href="/settings">
              <Settings aria-hidden="true" strokeWidth={1.7} />设置
            </Link>
          ) : null}
        </div>
      </header>
      <ProfileAvatarTransition profile={overview.profile} targetRef={avatarRef} />
      <ProfileCollections
        collection={collection}
        failure={collectionFailure}
        isLoading={isCollectionLoading}
        onRetry={retryCollections}
      />
      <section aria-labelledby="profile-recent-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="profile-recent-heading">最近播放</h2>
        </div>
        <StatusView
          description="当前上游读取契约尚未验证，因此未展示任何播放记录。"
          title="最近播放暂不可用"
          tone="info"
        />
      </section>
    </main>
  );
}
