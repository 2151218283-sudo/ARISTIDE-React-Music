// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Play } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlbumArtwork } from "../../src/components/AlbumArtwork";
import { IconButton } from "../../src/components/IconButton";
import { Skeleton } from "../../src/components/Skeleton";
import { StatusView } from "../../src/components/StatusView";
import { TextButton } from "../../src/components/TextButton";

afterEach(() => {
  cleanup();
});

function luminance(hex: string): number {
  const channels = hex.match(/[A-Fa-f0-9]{2}/g);

  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid test color: ${hex}`);
  }

  const [red, green, blue] = channels.map((channel) => {
    const normalized = Number.parseInt(channel, 16) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

describe("ECHOFORM foundation components", () => {
  it("keeps IconButton semantics and geometry stable while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton
        icon={<Play />}
        label="播放"
        onClick={onClick}
        pressed={false}
      />,
    );
    const button = screen.getByRole("button", { name: "播放" });
    const defaultClassName = button.className;

    expect(button).toHaveAttribute("title", "播放");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();

    button.focus();
    expect(button).toHaveFocus();

    rerender(
      <IconButton
        icon={<Play />}
        label="播放"
        loading
        onClick={onClick}
      />,
    );

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.className).toBe(defaultClassName);
  });

  it("keeps TextButton copy and reserved progress slot in loading and disabled states", () => {
    const { container, rerender } = render(
      <TextButton variant="secondary">重试</TextButton>,
    );
    const button = screen.getByRole("button", { name: "重试" });
    const defaultClassName = button.className;
    const leadingSlot = container.querySelector("span");

    expect(button).not.toBeDisabled();
    expect(leadingSlot).toBeInTheDocument();

    rerender(
      <TextButton loading variant="secondary">重试</TextButton>,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("重试");
    expect(button.className).toBe(defaultClassName);

    rerender(
      <TextButton disabled variant="secondary">重试</TextButton>,
    );
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("represents artwork loading, empty, error, unavailable, focus, and disabled states", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <AlbumArtwork
        alt="Afterimage - Quiet Form 封面"
        onClick={onClick}
        src="/assets/demo-cover.webp"
        status="loaded"
        variant="thumbnail"
      />,
    );
    const artworkButton = screen.getByRole("button", {
      name: "Afterimage - Quiet Form 封面",
    });

    expect(artworkButton).toHaveAttribute("data-status", "loaded");
    artworkButton.focus();
    expect(artworkButton).toHaveFocus();
    await user.click(artworkButton);
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <AlbumArtwork
        alt="Afterimage - Quiet Form 封面"
        onClick={onClick}
        src="/assets/demo-cover.webp"
        status="loading"
        variant="thumbnail"
      />,
    );
    expect(artworkButton).toHaveAttribute("aria-busy", "true");
    expect(artworkButton).toHaveAttribute("data-status", "loading");

    rerender(
      <AlbumArtwork
        alt="Afterimage - Quiet Form 封面"
        disabled
        onClick={onClick}
        src={null}
        status="empty"
        variant="thumbnail"
      />,
    );
    expect(artworkButton).toBeDisabled();
    expect(artworkButton).toHaveAttribute("data-status", "empty");
    expect(screen.getByText("暂无封面")).toBeInTheDocument();

    rerender(
      <AlbumArtwork
        alt="Afterimage - Quiet Form 封面"
        onClick={onClick}
        src={null}
        status="error"
        variant="thumbnail"
      />,
    );
    expect(screen.getByText("封面无法加载")).toBeInTheDocument();

    rerender(
      <AlbumArtwork
        alt="Afterimage - Quiet Form 封面"
        onClick={onClick}
        playing
        selected
        src="/assets/demo-cover.webp"
        status="unavailable"
        variant="thumbnail"
      />,
    );
    expect(screen.getByText("不可播放")).toBeInTheDocument();
    expect(artworkButton).toHaveAttribute("data-playing", "true");
    expect(artworkButton).toHaveAttribute("data-selected", "true");
  });

  it("renders recoverable empty and error StatusView states without color-only meaning", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const cancel = vi.fn();
    const { rerender } = render(
      <StatusView
        action={{ label: "重试", onClick: retry }}
        description="上游暂时无法响应，请稍后重试。"
        secondaryAction={{ disabled: true, label: "返回", onClick: cancel }}
        title="推荐加载失败"
        tone="error"
        variant="inline"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("推荐加载失败");
    expect(screen.getByText("上游暂时无法响应，请稍后重试。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();

    rerender(
      <StatusView
        description="今天还没有可展示的内容。"
        title="暂无推荐"
        tone="empty"
        variant="page"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("暂无推荐");
  });

  it("keeps decorative Skeleton hidden and exposes one optional loading label", () => {
    const { rerender } = render(<Skeleton variant="artwork" />);
    const skeleton = document.querySelector('[data-variant="artwork"]');

    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<Skeleton label="正在加载封面" variant="artwork" />);
    expect(screen.getByRole("status", { name: "正在加载封面" })).toBeVisible();
  });
});

describe("ECHOFORM token contract", () => {
  const projectRoot = process.cwd();
  const globals = readFileSync(resolve(projectRoot, "src/app/globals.css"), "utf8");
  const componentStyles = [
    "AlbumArtwork.module.css",
    "IconButton.module.css",
    "Skeleton.module.css",
    "StatusView.module.css",
    "TextButton.module.css",
  ].map((file) => readFileSync(resolve(projectRoot, "src/components", file), "utf8"));

  it("keeps raw hex colors inside primitive color declarations", () => {
    const rawHexLines = globals
      .split(/\r?\n/)
      .filter((line) => /#[A-Fa-f0-9]{3,8}\b/.test(line));

    expect(rawHexLines.length).toBeGreaterThan(0);
    expect(rawHexLines.every((line) => line.includes("--ef-color-"))).toBe(true);

    for (const stylesheet of componentStyles) {
      expect(stylesheet).not.toMatch(/#[A-Fa-f0-9]{3,8}\b/);
      expect(stylesheet).not.toContain("transition: all");
    }
  });

  it("defines all three theme mappings and reduced-motion overrides", () => {
    expect(globals).toContain(':root[data-theme="ink"]');
    expect(globals).toContain(':root[data-theme="paper"]');
    expect(globals).toContain(':root[data-theme="artwork"]');
    expect(globals).toContain("--ef-artwork-surface");

    for (const stylesheet of componentStyles) {
      expect(stylesheet).toContain("var(--ef-");
    }
    expect(componentStyles.join("\n")).toContain("prefers-reduced-motion: reduce");
  });

  it("meets the documented INK and PAPER fallback contrast thresholds", () => {
    expect(contrastRatio("#DADCD6", "#0C0D0D")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#8E918B", "#0C0D0D")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#0C0D0D", "#F2F0EA")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#666A65", "#F2F0EA")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#BAC8B7", "#0C0D0D")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#0C0D0D", "#F2F0EA")).toBeGreaterThanOrEqual(3);
  });

  it("keeps touch targets, artwork geometry, and growing text explicit", () => {
    const [artworkStyles, iconStyles, , statusStyles, textStyles] = componentStyles;

    expect(iconStyles).toContain("--ef-icon-button-size-md");
    expect(iconStyles).toContain("@media (max-width: 767px)");
    expect(artworkStyles).toContain("min-width: 44px");
    expect(artworkStyles).toContain("aspect-ratio: 1");
    expect(textStyles).toContain("--ef-text-button-height-mobile");
    expect(textStyles).toContain("overflow-wrap: anywhere");
    expect(statusStyles).toContain("overflow-wrap: anywhere");
  });
});
