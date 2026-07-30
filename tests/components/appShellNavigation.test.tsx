// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

import { AppShell, getAppShellVariant } from "../../src/components/AppShell";
import {
  FixedNavigation,
  getNavigationContext,
} from "../../src/components/FixedNavigation";
import { RoutePlaceholder } from "../../src/components/RoutePlaceholder";

afterEach(() => {
  cleanup();
  navigationState.pathname = "/";
});

describe("AppShell route contract", () => {
  it("maps only known ECHOFORM routes and leaves legacy work routes alone", () => {
    expect(getAppShellVariant("/")).toBe("immersive-fixed");
    expect(getAppShellVariant("/about")).toBe("immersive-fixed");
    expect(getAppShellVariant("/track/demo-track")).toBe("player-immersive");
    expect(getAppShellVariant("/search")).toBe("content-scroll");
    expect(getAppShellVariant("/album/demo-album")).toBe("content-scroll");
    expect(getAppShellVariant("/artist/demo-artist")).toBe("content-scroll");
    expect(getAppShellVariant("/library")).toBe("content-scroll");
    expect(getAppShellVariant("/playlist/demo-playlist")).toBe("content-scroll");
    expect(getAppShellVariant("/profile/demo-user")).toBe("content-scroll");
    expect(getAppShellVariant("/settings")).toBe("content-scroll");
    expect(getAppShellVariant("/lusion-v3")).toBeNull();
    expect(getAppShellVariant("/unknown/deep-route")).toBeNull();
  });

  it("renders one main landmark and an operable skip link", async () => {
    const user = userEvent.setup();
    navigationState.pathname = "/search";

    render(
      <AppShell>
        <h1 data-page-heading tabIndex={-1}>搜索</h1>
      </AppShell>,
    );

    const main = screen.getByRole("main", { name: "ECHOFORM 主内容" });
    const skipLink = screen.getByRole("link", { name: "跳到主内容" });

    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    await user.click(skipLink);
    expect(main).toHaveFocus();
  });

  it("moves focus to the destination heading after a client route change", () => {
    navigationState.pathname = "/search";
    const { rerender } = render(
      <AppShell>
        <h1 data-page-heading tabIndex={-1}>搜索</h1>
      </AppShell>,
    );

    navigationState.pathname = "/library";
    rerender(
      <AppShell>
        <h1 data-page-heading tabIndex={-1}>音乐库</h1>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "音乐库" })).toHaveFocus();
  });

  it("leaves a legacy route unwrapped", () => {
    navigationState.pathname = "/lusion-v3";
    render(
      <AppShell>
        <main aria-label="Legacy project">Legacy content</main>
      </AppShell>,
    );

    expect(screen.getByRole("main", { name: "Legacy project" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "跳到主内容" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "ECHOFORM 主导航" })).not.toBeInTheDocument();
  });
});

describe("FixedNavigation contract", () => {
  it("maps product routes to non-interactive context labels", () => {
    expect(getNavigationContext("/")).toBe("DAILY SIGNAL");
    expect(getNavigationContext("/search")).toBe("SEARCH");
    expect(getNavigationContext("/track/demo-track")).toBe("NOW PLAYING");
    expect(getNavigationContext("/album/demo-album")).toBe("ALBUM");
    expect(getNavigationContext("/artist/demo-artist")).toBe("ARTIST");
    expect(getNavigationContext("/library")).toBe("LIBRARY");
    expect(getNavigationContext("/playlist/demo-playlist")).toBe("PLAYLIST");
    expect(getNavigationContext("/profile/demo-user")).toBe("PROFILE");
    expect(getNavigationContext("/settings")).toBe("SETTINGS");
  });

  it("keeps only brand, search, and account as local destinations", () => {
    navigationState.pathname = "/playlist/demo-playlist";
    const { container } = render(<FixedNavigation />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);

    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^\//);
    }

    expect(screen.getByText("PLAYLIST")).not.toHaveAttribute("href");
    expect(screen.queryByRole("link", { name: "发现" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "音乐库" })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/aristidebenoist|href="(?:https?:|mailto:)/i);
  });

  it("keeps search one interaction away and labels icon-only account links", () => {
    navigationState.pathname = "/settings";
    render(<FixedNavigation />);

    expect(screen.getByRole("link", { name: "搜索" })).toHaveAttribute("href", "/search");
    const accountLink = screen.getByRole("link", { name: "账号与设置" });
    expect(accountLink).toHaveAttribute("href", "/settings");
    expect(accountLink).toHaveAttribute("aria-current", "page");
    expect(accountLink).toHaveAttribute("title", "账号与设置");
  });

  it("uses a normal-width brand face and disables the local dev indicator", () => {
    const projectRoot = process.cwd();
    const styles = readFileSync(
      resolve(projectRoot, "src/components/FixedNavigation.module.css"),
      "utf8",
    );
    const nextConfig = readFileSync(resolve(projectRoot, "next.config.ts"), "utf8");
    const brandRule = styles.match(/\.brand \{([\s\S]*?)\}/)?.[1] ?? "";

    expect(brandRule).toContain("var(--ef-font-body)");
    expect(brandRule).toContain("letter-spacing: 0");
    expect(brandRule).not.toContain("TNY");
    expect(brandRule).not.toContain("transform");
    expect(nextConfig).toContain("devIndicators: false");
  });
});

describe("RoutePlaceholder contract", () => {
  it("uses an honest information status without fake actions", () => {
    render(
      <RoutePlaceholder
        description="按关键词寻找音乐。"
        eyebrow="ECHOFORM / SEARCH"
        statusDescription="真实检索将在后续任务接入。"
        title="搜索"
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "搜索" })).toHaveAttribute("data-page-heading");
    expect(screen.getByRole("status")).toHaveTextContent("模块正在搭建");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
