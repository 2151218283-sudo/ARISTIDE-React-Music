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
  type RefObject,
} from "react";

import { PlaylistTile } from "@/components/PlaylistTile";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import type {
  UserPlaylistCollection,
  UserProfile,
  UserProfileOverview,
} from "@/lib/music/models";

import {
  registerProfileAvatarTransitionTarget,
  type ProfileAvatarPresentation,
  useProfileAvatarTransitionSnapshot,
} from "./profileAvatarTransition";
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

function Avatar({
  avatar,
  avatarRef,
  hidden,
}: {
  avatar: ProfileAvatarPresentation | null;
  avatarRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
}) {
  return (
    <div
      aria-label={avatar ? `${avatar.nickname}的头像` : undefined}
      className={styles.avatar}
      data-profile-header-avatar
      data-profile-avatar-transition-hidden={hidden || undefined}
      ref={avatarRef}
      role={avatar ? "img" : undefined}
    >
      {!avatar ? <Skeleton className={styles.avatarPlaceholder} variant="artwork" /> : null}
      {avatar ? <AvatarMedia key={`${avatar.nickname}-${avatar.avatarUrl ?? "fallback"}`} avatar={avatar} /> : null}
    </div>
  );
}

function AvatarMedia({ avatar }: { avatar: ProfileAvatarPresentation }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(avatar.avatarUrl) && !avatar.useFallback && !imageFailed;

  if (!showImage) {
    return (
      <span aria-label={`${avatar.nickname}的头像加载失败`} className={styles.avatarFallback}>
        {getInitial(avatar.nickname)}
      </span>
    );
  }

  return (
    <Image
      alt=""
      className={styles.avatarImage}
      fill
      onError={() => setImageFailed(true)}
      sizes="180px"
      src={avatar.avatarUrl ?? ""}
      unoptimized
    />
  );
}

function ProfileHeader({
  avatar,
  isCurrentUser,
  profile,
  targetHidden,
  targetRef,
}: {
  avatar: ProfileAvatarPresentation | null;
  isCurrentUser: boolean;
  profile: UserProfile | null;
  targetHidden: boolean;
  targetRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <header className={styles.header}>
      <Avatar avatar={avatar} avatarRef={targetRef} hidden={targetHidden} />
      <div className={styles.headerCopy}>
        {profile ? (
          <>
            <p className={styles.eyebrow}>{isCurrentUser ? "YOUR PROFILE" : "PUBLIC PROFILE"}</p>
            <h1 data-page-heading tabIndex={-1}>{profile.nickname}</h1>
            {profile.signature ? <p className={styles.signature}>{profile.signature}</p> : null}
            {isCurrentUser ? (
              <Link aria-label="打开个人设置" className={styles.settingsLink} href="/settings">
                <Settings aria-hidden="true" strokeWidth={1.7} />设置
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <Skeleton variant="line-short" />
            <Skeleton variant="line" />
            <Skeleton variant="line-short" />
          </>
        )}
      </div>
    </header>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-label="正在加载用户主页" className={styles.skeleton} role="status">
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
  const transitionSnapshot = useProfileAvatarTransitionSnapshot();
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

  useLayoutEffect(() => {
    const target = avatarRef.current;
    if (!target) {
      return;
    }
    return registerProfileAvatarTransitionTarget(userId, target);
  }, [userId]);

  const transitionRequest = transitionSnapshot.request?.userId === userId
    ? transitionSnapshot.request
    : null;
  const displayAvatar = overview?.profile ?? transitionRequest?.avatar ?? null;

  if (!overview) {
    if (isProfileLoading) {
      return (
        <main aria-busy="true" className={styles.page} data-profile-page>
          <Link className={styles.backLink} href="/"><ArrowLeft aria-hidden="true" />返回每日推荐</Link>
          <ProfileHeader
            avatar={displayAvatar}
            isCurrentUser={false}
            profile={null}
            targetHidden={Boolean(transitionRequest)}
            targetRef={avatarRef}
          />
          {showSkeleton ? <ProfileSkeleton /> : null}
        </main>
      );
    }

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
      <ProfileHeader
        avatar={displayAvatar}
        isCurrentUser={overview.isCurrentUser}
        profile={overview.profile}
        targetHidden={Boolean(transitionRequest)}
        targetRef={avatarRef}
      />
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
