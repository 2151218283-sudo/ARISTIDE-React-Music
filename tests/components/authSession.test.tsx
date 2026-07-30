// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

import { AuthAccountEntry } from "../../src/features/auth/AuthAccountEntry";
import { AuthProvider } from "../../src/features/auth/AuthProvider";

const user = {
  id: "9001",
  nickname: "测试用户",
  avatarUrl: "https://example.invalid/avatar.png",
  signature: null,
};

function success<T>(data: T): Response {
  return Response.json({ ok: true, data, meta: {} });
}

function failure(code: string): Response {
  return Response.json({ ok: false, error: { code } }, { status: 502 });
}

function createNonScannableImageDataUrl(): string {
  return `data:image/png;base64,${btoa("visual-stage-placeholder")}`;
}

function renderAccountEntry() {
  return render(
    <AuthProvider>
      <AuthAccountEntry />
    </AuthProvider>,
  );
}

async function waitForGuestEntry() {
  return await screen.findByRole("button", { name: "使用网易云音乐登录" });
}

afterEach(() => {
  cleanup();
  navigationState.pathname = "/";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ECHOFORM QR login dialog", () => {
  it("shows waiting and scanned states, pauses while hidden, and restores trigger focus on Escape", async () => {
    let statusRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return success({ mode: "real", user: null });
      }
      if (url === "/api/auth/qr") {
        return success({
          challengeId: "a".repeat(43),
          status: "waiting",
          qrImageDataUrl: createNonScannableImageDataUrl(),
          expiresAt: Date.now() + 60_000,
        });
      }
      if (url.startsWith("/api/auth/qr/status")) {
        statusRequests += 1;
        return success({
          status: "scanned",
          expiresAt: Date.now() + 60_000,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const userEventInstance = userEvent.setup();

    renderAccountEntry();
    const trigger = await waitForGuestEntry();
    await userEventInstance.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "使用网易云音乐扫码" });
    expect(dialog).toHaveAttribute("data-auth-phase", "waiting");
    expect(screen.getByAltText("请使用网易云音乐扫描此登录二维码")).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭登录" })).toHaveFocus();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(statusRequests).toBe(0);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await screen.findByText("请在手机上确认登录");
    expect(statusRequests).toBe(1);

    await userEventInstance.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    if (originalVisibility) {
      Object.defineProperty(document, "visibilityState", originalVisibility);
    }
  });

  it("renders network error, expired, refresh, and authorized states without a layout-changing QR stage", async () => {
    let startAttempts = 0;
    let status = "expired" as "expired" | "authorized";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return success({ mode: "real", user: null });
      }
      if (url === "/api/auth/qr") {
        startAttempts += 1;
        if (startAttempts === 1) {
          return failure("UPSTREAM_UNAVAILABLE");
        }
        return success({
          challengeId: "b".repeat(43),
          status: "waiting",
          qrImageDataUrl: createNonScannableImageDataUrl(),
          expiresAt: Date.now() + 60_000,
        });
      }
      if (url.startsWith("/api/auth/qr/status")) {
        return success(status === "expired"
          ? { status: "expired" }
          : { status: "authorized", user });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const userEventInstance = userEvent.setup();

    renderAccountEntry();
    await userEventInstance.click(await waitForGuestEntry());
    await screen.findByText("无法连接登录服务");
    const stage = screen.getByTestId("qr-stage");
    expect(stage).toBeInTheDocument();

    await userEventInstance.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("使用网易云音乐扫码");
    expect(screen.getByTestId("qr-stage")).toBe(stage);

    document.dispatchEvent(new Event("visibilitychange"));
    await screen.findByText("二维码已过期");
    expect(screen.getByRole("button", { name: "刷新二维码" })).toBeVisible();
    expect(screen.getByTestId("qr-stage")).toBe(stage);

    status = "authorized";
    await userEventInstance.click(screen.getByRole("button", { name: "刷新二维码" }));
    await screen.findByText("使用网易云音乐扫码");
    document.dispatchEvent(new Event("visibilitychange"));
    await screen.findByText("登录成功");
    expect(screen.getByRole("link", { name: "测试用户的个人主页" }))
      .toHaveAttribute("href", "/profile/9001");
  });
});

describe("ECHOFORM account entry", () => {
  it("falls back from a failed avatar and logs out through the account menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return success({ mode: "real", user });
      }
      if (url === "/api/auth/logout" && init?.method === "POST") {
        return success({ mode: "real", user: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const userEventInstance = userEvent.setup();

    renderAccountEntry();
    const avatar = await screen.findByRole("img", { name: "测试用户的头像" });
    fireEvent.error(avatar);
    expect(screen.getByLabelText("测试用户的头像加载失败")).toHaveTextContent("测");

    await userEventInstance.click(screen.getByRole("button", { name: "账号菜单" }));
    expect(screen.getByRole("menuitem", { name: "设置" })).toHaveAttribute("href", "/settings");
    await userEventInstance.click(screen.getByRole("menuitem", { name: "退出登录" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "使用网易云音乐登录" })).toBeVisible();
    });
  });
});
