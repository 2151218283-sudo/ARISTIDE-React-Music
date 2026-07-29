import { CirclePlay, Search } from "lucide-react";
import { createRoot } from "react-dom/client";

import "../../src/app/globals.css";
import { AlbumArtwork } from "../../src/components/AlbumArtwork";
import { IconButton } from "../../src/components/IconButton";
import { Skeleton } from "../../src/components/Skeleton";
import { StatusView } from "../../src/components/StatusView";
import { TextButton } from "../../src/components/TextButton";
import styles from "./foundationPreview.module.css";

function FoundationPreview() {
  return (
    <main className={styles.preview} data-preview-root>
      <header className={styles.header}>
        <p className={styles.eyebrow} data-secondary-text>ECHOFORM</p>
        <h1 className={styles.title}>基础组件状态验收</h1>
      </header>

      <section className={styles.section} aria-labelledby="button-preview-title">
        <h2 id="button-preview-title">Controls</h2>
        <div className={styles.controls}>
          <IconButton
            data-touch-target
            icon={<CirclePlay />}
            label="播放"
          />
          <IconButton
            data-loading-control
            data-touch-target
            icon={<Search />}
            label="正在搜索"
            loading
          />
          <IconButton
            data-touch-target
            disabled
            icon={<Search />}
            label="搜索不可用"
          />
          <TextButton data-text-target>确认</TextButton>
          <TextButton
            data-stable-button="default"
            data-text-target
            variant="secondary"
          >
            重试
          </TextButton>
          <TextButton
            data-stable-button="loading"
            data-text-target
            loading
            variant="secondary"
          >
            重试
          </TextButton>
          <TextButton data-text-target disabled variant="quiet">暂不可用</TextButton>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="artwork-preview-title">
        <h2 id="artwork-preview-title">Artwork</h2>
        <div className={styles.artworks}>
          <AlbumArtwork
            alt="加载中的专辑封面"
            src={null}
            status="loading"
          />
          <AlbumArtwork alt="暂无专辑封面" src={null} status="empty" />
          <AlbumArtwork alt="损坏的专辑封面" src={null} status="error" />
          <AlbumArtwork
            alt="不可播放的专辑封面"
            onClick={() => undefined}
            playing
            selected
            src={null}
            status="unavailable"
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="status-preview-title">
        <h2 id="status-preview-title">Status</h2>
        <StatusView
          action={{ label: "重试", onClick: () => undefined }}
          description="连接暂时不可用，已有内容保持不变。请检查网络后再次尝试。"
          secondaryAction={{ label: "返回", onClick: () => undefined }}
          title="推荐加载失败"
          tone="error"
        />
      </section>

      <section className={styles.section} aria-labelledby="skeleton-preview-title">
        <h2 id="skeleton-preview-title">Skeleton</h2>
        <div className={styles.skeletons}>
          <Skeleton label="正在加载预览" variant="artwork" />
          <div className={styles.lines}>
            <Skeleton variant="line" />
            <Skeleton variant="line-short" />
            <Skeleton variant="button" />
          </div>
        </div>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Foundation preview root is missing.");
}

createRoot(rootElement).render(<FoundationPreview />);
