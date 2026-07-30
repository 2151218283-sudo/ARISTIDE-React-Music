"use client";

import { Skeleton } from "@/components/Skeleton";
import { TextButton } from "@/components/TextButton";
import { useAuth } from "@/features/auth/AuthProvider";

import { useDailyRecommendationsState } from "./DailyRecommendationsProvider";
import styles from "./DailyRecommendationStatus.module.css";

interface StatusContent {
  action?: {
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary" | "quiet";
  };
  description: string;
  label: string;
  state: "demo" | "empty" | "error" | "personal" | "public";
  secondaryAction?: {
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary" | "quiet";
  };
  tone: "error" | "info" | "success";
}

export function DailyRecommendationStatus() {
  const {
    mode,
    modeChanging,
    openLogin,
    setMode,
    status: authStatus,
    user,
  } = useAuth();
  const recommendations = useDailyRecommendationsState();

  if (authStatus === "loading" || modeChanging || recommendations.status === "loading") {
    return <LoadingStatus modeChanging={modeChanging} />;
  }

  if (recommendations.status === "error") {
    return (
      <StatusSurface
        content={errorContent(
          recommendations.error?.code ?? "UNKNOWN_ERROR",
          openLogin,
          recommendations.retry,
          () => void setMode("demo"),
        )}
        disabled={modeChanging}
      />
    );
  }

  const data = recommendations.data;
  if (data?.source === "demo") {
    return (
      <StatusSurface
        content={{
          label: "DEMO",
          state: "demo",
          description: data.tracks.length === 0
            ? "本地演示数据暂时没有可展示的推荐。"
            : "正在使用本地演示数据，未混入你的实时推荐。",
          action: {
            label: "返回实时数据",
            onClick: () => void setMode("real"),
            variant: "secondary",
          },
          tone: "info",
        }}
        disabled={modeChanging}
      />
    );
  }

  if (!data || data.tracks.length === 0) {
    return (
      <StatusSurface
        content={{
          label: mode === "demo" ? "DEMO" : "PUBLIC SELECTION",
          state: mode === "demo" ? "demo" : "empty",
          description: "暂时没有可展示的推荐，请稍后重新加载。",
          action: { label: "重新加载", onClick: recommendations.retry },
          tone: "info",
        }}
      />
    );
  }

  if (data.source === "personal") {
    return (
      <StatusSurface
        content={{
          label: "YOUR DAILY SIGNAL",
          state: "personal",
          description: "这是你今天的个人每日推荐。",
          tone: "success",
        }}
      />
    );
  }

  const isAuthenticatedFallback = user !== null;
  return (
    <StatusSurface
      content={{
        label: "PUBLIC SELECTION",
        state: "public",
        description: isAuthenticatedFallback
          ? "今日个人日推暂未返回，当前展示公开精选。"
          : "当前展示公开精选；扫码后可查看你的每日推荐。",
        action: isAuthenticatedFallback
          ? { label: "重新加载日推", onClick: recommendations.retry }
          : { label: "扫码查看你的日推", onClick: openLogin },
        tone: "info",
      }}
    />
  );
}

function errorContent(
  code: string,
  openLogin: () => void,
  retry: () => void,
  enterDemo: () => void,
): StatusContent {
  if (code === "SESSION_EXPIRED" || code === "AUTH_REQUIRED") {
    return {
      label: "登录状态已失效",
      state: "error",
      description: "请重新扫码登录后再读取你的每日推荐。",
      action: { label: "重新扫码", onClick: openLogin },
      secondaryAction: { label: "使用演示数据", onClick: enterDemo, variant: "quiet" },
      tone: "error",
    };
  }

  return {
    label: "无法载入今日推荐",
    state: "error",
    description: "实时推荐服务暂时不可用，重试不会自动切换到演示数据。",
    action: { label: "重试", onClick: retry },
    secondaryAction: { label: "使用演示数据", onClick: enterDemo, variant: "quiet" },
    tone: "error",
  };
}

interface LoadingStatusProps {
  modeChanging: boolean;
}

function LoadingStatus({ modeChanging }: LoadingStatusProps) {
  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className={styles.surface}
      data-state="loading"
      role="status"
    >
      <p className={styles.label}>{modeChanging ? "正在切换数据模式" : "正在载入今日推荐"}</p>
      <Skeleton className={styles.loadingTitle} variant="line" />
      <Skeleton className={styles.loadingDescription} variant="line-short" />
    </section>
  );
}

interface StatusSurfaceProps {
  content: StatusContent;
  disabled?: boolean;
}

function StatusSurface({ content, disabled = false }: StatusSurfaceProps) {
  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className={styles.surface}
      data-state={content.state}
      data-tone={content.tone}
      role={content.tone === "error" ? "alert" : "status"}
    >
      <p className={styles.label}>{content.label}</p>
      <p className={styles.description}>{content.description}</p>
      {content.action || content.secondaryAction ? (
        <div className={styles.actions}>
          {content.action ? (
            <TextButton
              disabled={disabled}
              onClick={content.action.onClick}
              variant={content.action.variant ?? "primary"}
            >
              {content.action.label}
            </TextButton>
          ) : null}
          {content.secondaryAction ? (
            <TextButton
              disabled={disabled}
              onClick={content.secondaryAction.onClick}
              variant={content.secondaryAction.variant ?? "quiet"}
            >
              {content.secondaryAction.label}
            </TextButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
