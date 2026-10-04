// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  mode: "real" as "real" | "demo",
  openLogin: vi.fn(),
  status: "ready" as "loading" | "ready",
  user: null as { id: string; nickname: string; avatarUrl: string | null; signature: string | null } | null,
}));

vi.mock("../../src/features/auth/AuthProvider", () => ({
  useAuth: () => auth,
}));

import { LibraryActionButton } from "../../src/features/library/LibraryActionButton";
import { LibraryMutationProvider } from "../../src/features/library/LibraryMutationProvider";
import type { AlbumSummary, Track } from "../../src/lib/music/models";

const track: Track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: null },
};

const album: AlbumSummary = {
  id: "301",
  name: "Synthetic Album",
  artworkUrl: null,
};

function page<T>(items: T[]) {
  return { items, total: items.length, limit: 50, offset: 0, hasMore: false };
}

function success(data: unknown): Response {
  return Response.json({ ok: true, data });
}

function failure(code: string, message: string): Response {
  return Response.json({
    ok: false,
    error: { code, message, retryable: code !== "AUTH_REQUIRED" },
  }, { status: code === "AUTH_REQUIRED" ? 401 : 502 });
}

function renderAction(kind: "track" | "album" = "track") {
  return render(
    <LibraryMutationProvider>
      <LibraryActionButton entity={kind === "track" ? track : album} kind={kind} />
    </LibraryMutationProvider>,
  );
}

beforeEach(() => {
  auth.mode = "real";
  auth.openLogin.mockReset();
  auth.status = "ready";
  auth.user = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LibraryActionButton", () => {
  it("opens QR login for an anonymous action without changing the visible state", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderAction();

    const button = screen.getByRole("button", { name: "喜欢 Synthetic Signal" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(auth.openLogin).toHaveBeenCalledOnce());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("confirms a like once, ignores duplicate clicks, and updates after the response", async () => {
    auth.user = { id: "701", nickname: "Listener", avatarUrl: null, signature: null };
    let resolveWrite!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/api/library/likes")) {
        return Promise.resolve(success(page<Track>([])));
      }
      if (method === "GET" && url.includes("/api/library/albums")) {
        return Promise.resolve(success(page<AlbumSummary>([])));
      }
      return new Promise<Response>((resolve) => {
        resolveWrite = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAction();

    const button = await screen.findByRole("button", { name: "喜欢 Synthetic Signal" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    resolveWrite(success({ kind: "track-like", id: "101", active: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消喜欢 Synthetic Signal" }))
      .toHaveAttribute("aria-pressed", "true"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the prior state and exposes an inline retry after an upstream failure", async () => {
    auth.user = { id: "701", nickname: "Listener", avatarUrl: null, signature: null };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/api/library/likes")) {
        return Promise.resolve(success(page<Track>([])));
      }
      if (method === "GET" && url.includes("/api/library/albums")) {
        return Promise.resolve(success(page<AlbumSummary>([])));
      }
      return Promise.resolve(failure("UPSTREAM_UNAVAILABLE", "音乐库暂时不可用，请重试。"));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAction("album");

    const button = await screen.findByRole("button", { name: "收藏专辑 Synthetic Album" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("音乐库暂时不可用，请重试。");
    expect(screen.getByRole("button", { name: "收藏专辑 Synthetic Album" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("opens QR login on an expired session and preserves an existing like", async () => {
    auth.user = { id: "701", nickname: "Listener", avatarUrl: null, signature: null };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/api/library/likes")) {
        return Promise.resolve(success(page([track])));
      }
      if (method === "GET" && url.includes("/api/library/albums")) {
        return Promise.resolve(success(page<AlbumSummary>([])));
      }
      return Promise.resolve(failure("AUTH_REQUIRED", "请先完成扫码登录。"));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAction();

    const button = await screen.findByRole("button", { name: "取消喜欢 Synthetic Signal" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(auth.openLogin).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "取消喜欢 Synthetic Signal" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});
