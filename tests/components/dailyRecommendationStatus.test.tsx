// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DailyRecommendationStatus } from "../../src/features/discovery/DailyRecommendationStatus";
import { DailyRecommendationsProvider } from "../../src/features/discovery/DailyRecommendationsProvider";
import { AuthProvider, useAuth } from "../../src/features/auth/AuthProvider";
import {
  PlayerRuntimeContext,
  type PlayerRuntimeContextValue,
} from "../../src/features/player/playerContext";

const playerDispatch = vi.fn();
const playerRuntime = {
  dispatch: playerDispatch,
} as unknown as PlayerRuntimeContextValue;

const user = {
  id: "9001",
  nickname: "Test Listener",
  avatarUrl: null,
  signature: null,
};
const track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown",
  privilege: { fee: 0, maxQuality: null },
};

function success<T>(data: T): Response {
  return Response.json({ ok: true, data, meta: { mode: "real" } });
}

function failure(code: string): Response {
  return Response.json({
    ok: false,
    error: {
      code,
      message: "Synthetic failure",
      retryable: true,
      requestId: "component-test",
    },
  }, { status: 503 });
}

function AuthProbe() {
  const { loginOpen } = useAuth();
  return <div data-testid="login-open">{String(loginOpen)}</div>;
}

function renderStatus() {
  return render(
    <PlayerRuntimeContext.Provider value={playerRuntime}>
      <AuthProvider>
        <DailyRecommendationsProvider>
          <DailyRecommendationStatus />
          <AuthProbe />
        </DailyRecommendationsProvider>
      </AuthProvider>
    </PlayerRuntimeContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  playerDispatch.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DailyRecommendationStatus", () => {
  it("keeps a local loading stage before revealing a guest public selection", async () => {
    const pendingDaily = { resolve: null as ((response: Response) => void) | null };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") {
        return Promise.resolve(success({ mode: "real", user: null }));
      }
      if (String(input) === "/api/recommendations/daily") {
        return new Promise<Response>((resolve) => {
          pendingDaily.resolve = resolve;
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStatus();
    const loading = await screen.findByRole("status");
    expect(loading).toHaveTextContent("正在载入今日推荐");
    expect(loading).toHaveAttribute("data-state", "loading");

    await waitFor(() => {
      expect(pendingDaily.resolve).not.toBeNull();
    });

    const resolveDaily = pendingDaily.resolve;
    if (!resolveDaily) {
      throw new Error("Expected the delayed daily request to be pending.");
    }
    resolveDaily(success({
      date: "2026-07-30",
      source: "public",
      tracks: [track],
    }));

    expect(await screen.findByText("PUBLIC SELECTION")).toBeVisible();
    const loginAction = screen.getByRole("button", { name: "扫码查看你的日推" });
    await userEvent.setup().click(loginAction);
    expect(screen.getByTestId("login-open")).toHaveTextContent("true");
  });

  it("retains the Real error until the user explicitly enters and exits Demo", async () => {
    let mode = "real" as "real" | "demo";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return success({ mode: "real", user });
      }
      if (url === "/api/recommendations/daily") {
        if (mode === "real") {
          return failure("UPSTREAM_UNAVAILABLE");
        }
        return success({
          date: "2026-07-30",
          source: "demo",
          tracks: [track],
        });
      }
      if (url === "/api/mode" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { mode: "real" | "demo" };
        mode = body.mode;
        return success({ mode, user: mode === "demo" ? null : user });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const userEventInstance = userEvent.setup();

    renderStatus();
    await screen.findByRole("alert");
    expect(screen.getByText("无法载入今日推荐")).toBeVisible();
    expect(screen.queryByText("DEMO")).not.toBeInTheDocument();

    await userEventInstance.click(screen.getByRole("button", { name: "使用演示数据" }));
    expect(await screen.findByText("DEMO")).toBeVisible();
    expect(playerDispatch).toHaveBeenCalledWith({ type: "UNLOAD" });

    await userEventInstance.click(screen.getByRole("button", { name: "返回实时数据" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("无法载入今日推荐");
    });
    expect(playerDispatch).toHaveBeenCalledTimes(2);
  });

  it("renders a personal daily recommendation distinctly from public data", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") {
        return success({ mode: "real", user });
      }
      if (String(input) === "/api/recommendations/daily") {
        return success({ date: "2026-07-30", source: "personal", tracks: [track] });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStatus();
    expect(await screen.findByText("YOUR DAILY SIGNAL")).toBeVisible();
    expect(screen.queryByText("PUBLIC SELECTION")).not.toBeInTheDocument();
  });

  it("uses fallback-public and empty states without relabeling public data", async () => {
    const dailyResponses = [
      { source: "public", tracks: [track] },
      { source: "public", tracks: [] },
    ] as const;
    let dailyIndex = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") {
        return success({ mode: "real", user });
      }
      if (String(input) === "/api/recommendations/daily") {
        const current = dailyResponses[Math.min(dailyIndex, dailyResponses.length - 1)];
        dailyIndex += 1;
        return success({ date: "2026-07-30", ...current });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const userEventInstance = userEvent.setup();

    renderStatus();
    await screen.findByText("今日个人日推暂未返回，当前展示公开精选。");
    expect(screen.getByText("PUBLIC SELECTION")).toBeVisible();

    await userEventInstance.click(screen.getByRole("button", { name: "重新加载日推" }));
    expect(await screen.findByText("暂时没有可确认可播放的公开精选，请稍后重新加载。")).toBeVisible();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeVisible();
  });
});
