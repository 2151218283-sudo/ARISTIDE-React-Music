// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaylistExperience } from "../../src/features/library/PlaylistExperience";
import { CreatePlaylistDialog } from "../../src/features/library/CreatePlaylistDialog";
import { AddToPlaylistButton } from "../../src/features/library/AddToPlaylistButton";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({
  mode: "real" as "real" | "demo",
  status: "ready",
  user: { id: "701", nickname: "Synthetic Owner", avatarUrl: null, signature: null },
  openLogin: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../src/features/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("../../src/components/TrackRow", () => ({ TrackRow: ({ track }: { track: { name: string } }) => <div>{track.name}</div> }));

const playlist = {
  id: "801", name: "Synthetic Playlist", description: null, tags: [], artworkUrl: null,
  owner: auth.user, visibility: "public", trackCount: 0, createdAt: null, updatedAt: null,
};
const apiDetail = { playlist, tracks: [], canEdit: true };
const ok = (data: unknown) => Response.json({ ok: true, data });

beforeEach(() => {
  auth.mode = "real";
  auth.user = { id: "701", nickname: "Synthetic Owner", avatarUrl: null, signature: null };
  router.push.mockReset();
  auth.openLogin.mockReset();
});

describe("AddToPlaylistButton", () => {
  it("does not show another account's playlist after an account switch and failed reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/701/")
      ? ok({ liked: null, created: [playlist], subscribed: [] })
      : Response.json({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "读取失败。", retryable: true } }, { status: 502 })));
    const view = render(<AddToPlaylistButton trackId="101" trackName="Synthetic Track" />);
    fireEvent.click(screen.getByRole("button", { name: "将 Synthetic Track 加入歌单" }));
    expect(await screen.findByRole("button", { name: "Synthetic Playlist" })).toBeVisible();
    auth.user = { id: "702", nickname: "Second Owner", avatarUrl: null, signature: null };
    view.rerender(<AddToPlaylistButton trackId="101" trackName="Synthetic Track" />);
    expect(screen.queryByRole("button", { name: "Synthetic Playlist" })).not.toBeInTheDocument();
    expect(await screen.findByText("读取失败。")).toBeVisible();
    expect(screen.queryByText("还没有创建的歌单。")).not.toBeInTheDocument();
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PlaylistExperience", () => {
  it("shows not-found and recovers from a retryable read failure", async () => {
    const missing = Response.json({ ok: false, error: { code: "TRACK_UNAVAILABLE", message: "未找到这个歌单。", retryable: false } }, { status: 404 });
    vi.stubGlobal("fetch", vi.fn(async () => missing));
    const view = render(<PlaylistExperience playlistId="801" />);
    expect(await screen.findByRole("heading", { name: "找不到歌单" })).toBeVisible();
    view.unmount();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ++reads === 1
      ? Response.json({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "读取失败。", retryable: true } }, { status: 502 })
      : ok(apiDetail)));
    render(<PlaylistExperience playlistId="801" />);
    expect(await screen.findByRole("heading", { name: "歌单暂时不可用" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Synthetic Playlist" })).toBeVisible();
  });

  it("uses system share when it succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(apiDetail)));
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<PlaylistExperience playlistId="801" />);
    await screen.findByRole("heading", { level: 1, name: "Synthetic Playlist" });
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Synthetic Playlist", url: "http://localhost:3000/playlist/801" }));
    expect(writeText).not.toHaveBeenCalled();
  });
  it("renders an empty playlist and shares a local URL through clipboard fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(apiDetail)));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    render(<PlaylistExperience playlistId="801" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Synthetic Playlist" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "这个歌单还没有歌曲" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/playlist/801"));
    expect(screen.getByText("本站歌单链接已复制。")).toBeVisible();
  });

  it("keeps the detail after a failed delete and navigates only after confirmation succeeds", async () => {
    let deleteCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteCount += 1;
        return deleteCount === 1 ? Response.json({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "删除暂时失败。", retryable: true } }, { status: 502 })
          : ok({ playlistId: "801", deleted: true });
      }
      return ok(apiDetail);
    }));
    render(<PlaylistExperience playlistId="801" />);
    await screen.findByRole("heading", { level: 1, name: "Synthetic Playlist" });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(deleteCount).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("删除暂时失败。")).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/library"));
    expect(deleteCount).toBe(2);
  });

  it("confirms track removal, restores focus on cancel, and leaves external data untouched", async () => {
    const track = {
      id: "101", name: "Synthetic Track", artists: [{ id: "201", name: "Artist", avatarUrl: null }],
      album: { id: "301", name: "Album", artworkUrl: null }, durationMs: 120000,
      artworkUrl: null, aliases: [], explicit: false, availability: "unknown",
      privilege: { fee: 0, maxQuality: null },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? ok({ playlistId: "801", operation: "remove", trackIds: ["101"] })
      : ok({ ...apiDetail, tracks: [track] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PlaylistExperience playlistId="801" />);
    const trigger = await screen.findByRole("button", { name: "从歌单移除 Synthetic Track" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "移除 Synthetic Track？" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(trigger).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  });

  it("shows protected data as unavailable and offers no owner writes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "AUTH_REQUIRED", message: "未公开", retryable: false } }, { status: 401 })));
    render(<PlaylistExperience playlistId="801" />);
    expect(await screen.findByRole("heading", { name: "歌单未公开" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("stops after a partial edit failure and refreshes confirmed fields", async () => {
    const fields: string[] = [];
    let description = "";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const update = JSON.parse(String(init.body)) as { field: string };
        fields.push(update.field);
        if (update.field === "description") return Response.json({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "描述失败。", retryable: true } }, { status: 502 });
        return ok({ playlistId: "801", field: update.field });
      }
      return ok({ ...apiDetail, playlist: { ...playlist, name: fields.includes("name") ? "Renamed" : playlist.name, description: description || null } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PlaylistExperience playlistId="801" />);
    await screen.findByRole("heading", { level: 1, name: "Synthetic Playlist" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Renamed" } });
    description = "new description";
    fireEvent.change(screen.getByLabelText("描述"), { target: { value: description } });
    fireEvent.change(screen.getByLabelText(/标签/), { target: { value: "Electronic" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByText(/部分修改已保存，后续操作已停止/)).toBeVisible();
    expect(fields).toEqual(["name", "description"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Renamed" })).toBeVisible();
  });

  it("requires explicit confirmation before publishing a private playlist", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH"
      ? ok({ playlistId: "801", field: "publish" })
      : ok({ ...apiDetail, playlist: { ...playlist, visibility: "private" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PlaylistExperience playlistId="801" />);
    await screen.findByRole("button", { name: "设为公开" });
    fireEvent.click(screen.getByRole("button", { name: "设为公开" }));
    expect(screen.getByText(/无法把它改回私密/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "设为公开" }));
    fireEvent.click(screen.getByRole("button", { name: "确认公开" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
  });
});

describe("CreatePlaylistDialog", () => {
  it("permits private creation after the dedicated-account contract verification", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ok({ ...playlist, visibility: "private" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CreatePlaylistDialog open onClose={vi.fn()} onCreated={vi.fn()} triggerRef={{ current: null }} />);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Private Signals" } });
    fireEvent.click(screen.getByLabelText("私密"));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ visibility: "private" });
  });
  it("validates, prevents duplicate submit, and only reports a confirmed creation", async () => {
    let resolveWrite: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async () => new Promise<Response>((resolve) => { resolveWrite = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreatePlaylistDialog open onClose={onClose} onCreated={onCreated} triggerRef={{ current: null }} />);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Synthetic Playlist" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    resolveWrite?.(ok(playlist));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(playlist));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
