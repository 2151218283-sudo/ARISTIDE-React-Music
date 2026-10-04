import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/lib/music/errors";
import { createPlaylistRouteHandlers, type PlaylistProvider } from "../../src/lib/music/playlistBff";
import type { Playlist, PlaylistDetail } from "../../src/lib/music/models";
import { InMemorySessionStore, SESSION_COOKIE_NAME } from "../../src/lib/session/sessionStore";

const playlist: Playlist = {
  id: "801", name: "Synthetic Playlist", description: null, tags: [], artworkUrl: null,
  owner: { id: "701", nickname: "Synthetic Owner", avatarUrl: null, signature: null },
  visibility: "public", trackCount: 0, createdAt: null, updatedAt: null,
};
const detail: PlaylistDetail = { playlist, tracks: [], canEdit: true };

function makeProvider(): PlaylistProvider {
  return {
    getPlaylist: vi.fn(async () => detail),
    createPlaylist: vi.fn(async () => playlist),
    changePlaylistTracks: vi.fn(async () => {}),
    deletePlaylist: vi.fn(async () => {}),
    updatePlaylist: vi.fn(async () => {}),
  };
}

function setup() {
  const store = new InMemorySessionStore();
  const session = store.create();
  session.user = playlist.owner;
  session.upstreamCookie = "synthetic-server-credential";
  const real = makeProvider();
  const demo = makeProvider();
  const handlers = createPlaylistRouteHandlers({
    store, createRealProvider: () => real, createDemoProvider: () => demo,
  });
  const cookie = `${SESSION_COOKIE_NAME}=${session.id}`;
  const request = (path: string, body?: object, method = "GET", authenticated = true) => new Request(`https://echoform.test${path}`, {
    method,
    headers: authenticated ? { Cookie: cookie, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { store, session, real, demo, handlers, request };
}

describe("playlist route contract", () => {
  it("reads public detail without a session and blocks a private playlist", async () => {
    const { handlers, real, request } = setup();
    const publicResponse = await handlers.detail(request("/api/playlists/801", undefined, "GET", false), "801");
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await publicResponse.json()).toMatchObject({ ok: true, data: { playlist: { id: "801" }, canEdit: false } });
    vi.mocked(real.getPlaylist).mockResolvedValueOnce({ ...detail, playlist: { ...playlist, visibility: "private" } });
    const privateResponse = await handlers.detail(request("/api/playlists/801", undefined, "GET", false), "801");
    expect(privateResponse.status).toBe(401);
    expect(await privateResponse.json()).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
  });

  it("requires a session and validates creation before any provider write", async () => {
    const { handlers, real, request } = setup();
    const anonymous = await handlers.create(request("/api/playlists", { name: "A", visibility: "public", clientMutationId: "mutation-anonymous-0001" }, "POST", false));
    const invalid = await handlers.create(request("/api/playlists", { name: " ", visibility: "public", clientMutationId: "mutation-invalid-00001" }, "POST"));
    expect(anonymous.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(real.createPlaylist).not.toHaveBeenCalled();
  });

  it("allows verified private creation in real mode", async () => {
    const { handlers, real, request } = setup();
    const result = await handlers.create(request("/api/playlists", {
      name: "Private Synthetic Playlist", visibility: "private", clientMutationId: "mutation-private-00001",
    }, "POST"));
    expect(result.status).toBe(200);
    expect(real.createPlaylist).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }), "synthetic-server-credential");
  });

  it("coalesces simultaneous writes and returns the same confirmed result", async () => {
    const { handlers, real, request } = setup();
    let release: ((value: Playlist) => void) | undefined;
    vi.mocked(real.createPlaylist).mockImplementation(() => new Promise<Playlist>((resolve) => { release = resolve; }));
    const body = { name: "Synthetic Playlist", visibility: "public", clientMutationId: "mutation-create-000001" };
    const first = handlers.create(request("/api/playlists", body, "POST"));
    const second = handlers.create(request("/api/playlists", body, "POST"));
    await vi.waitFor(() => expect(real.createPlaylist).toHaveBeenCalledTimes(1));
    release?.(playlist);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const third = await handlers.create(request("/api/playlists", body, "POST"));
    expect(third.status).toBe(200);
    expect(real.createPlaylist).toHaveBeenCalledTimes(1);
  });

  it("checks ownership before a track removal or delete and sends no write for a guest", async () => {
    const { handlers, real, request } = setup();
    vi.mocked(real.getPlaylist).mockResolvedValue({ ...detail, playlist: { ...playlist, owner: { ...playlist.owner!, id: "702" } } });
    const removal = await handlers.tracks(request("/api/playlists/801/tracks", {
      operation: "remove", trackIds: ["101"], clientMutationId: "mutation-remove-000001",
    }, "POST"), "801");
    const deletion = await handlers.delete(request("/api/playlists/801", {
      clientMutationId: "mutation-delete-000001",
    }, "DELETE"), "801");
    expect(removal.status).toBe(401);
    expect(deletion.status).toBe(401);
    expect(real.changePlaylistTracks).not.toHaveBeenCalled();
    expect(real.deletePlaylist).not.toHaveBeenCalled();
  });

  it("rejects mixed valid and invalid track IDs without a partial write", async () => {
    const { handlers, real, request } = setup();
    const response = await handlers.tracks(request("/api/playlists/801/tracks", {
      operation: "add", trackIds: ["101", null], clientMutationId: "mutation-invalid-tracks-01",
    }, "POST"), "801");
    expect(response.status).toBe(400);
    expect(real.changePlaylistTracks).not.toHaveBeenCalled();
  });

  it("does not retry failed removals and leaves their mutation ID uncached", async () => {
    const { handlers, real, request } = setup();
    vi.mocked(real.changePlaylistTracks).mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE", "曲目移除未完成。", { retryable: true }));
    const body = { operation: "remove", trackIds: ["101"], clientMutationId: "mutation-remove-000002" };
    const response = await handlers.tracks(request("/api/playlists/801/tracks", body, "POST"), "801");
    expect(response.status).toBe(502);
    expect(real.changePlaylistTracks).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE" } });
  });

  it("checks ownership, field bounds and publish direction before editing", async () => {
    const { handlers, real, request } = setup();
    const write = (field: string, value: unknown, id: string) => handlers.update(request("/api/playlists/801", {
      field, value, clientMutationId: id,
    }, "PATCH"), "801");
    expect((await write("name", " ", "mutation-invalid-name-01")).status).toBe(400);
    expect((await write("tags", ["one", "one"], "mutation-invalid-tags-01")).status).toBe(400);
    expect((await write("publish", undefined, "mutation-invalid-publish-01")).status).toBe(400);
    expect(real.updatePlaylist).not.toHaveBeenCalled();
    vi.mocked(real.getPlaylist).mockResolvedValueOnce({ ...detail, playlist: { ...playlist, owner: { ...playlist.owner!, id: "702" } } });
    expect((await write("name", "Changed", "mutation-guest-update-01")).status).toBe(401);
    expect(real.updatePlaylist).not.toHaveBeenCalled();
  });

  it("coalesces a single-field edit and publishes only a private owned playlist", async () => {
    const { handlers, real, request } = setup();
    const editBody = { field: "description", value: "Updated", clientMutationId: "mutation-update-desc-001" };
    const write = (body: object) => handlers.update(request("/api/playlists/801", body, "PATCH"), "801");
    const [first, second] = await Promise.all([write(editBody), write(editBody)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await write(editBody)).status).toBe(200);
    expect(real.updatePlaylist).toHaveBeenCalledTimes(1);
    expect(real.updatePlaylist).toHaveBeenCalledWith(expect.objectContaining({ update: { field: "description", value: "Updated" } }), "synthetic-server-credential");
    vi.mocked(real.getPlaylist).mockResolvedValueOnce({ ...detail, playlist: { ...playlist, visibility: "private" } });
    expect((await write({ field: "publish", clientMutationId: "mutation-publish-00001" })).status).toBe(200);
    expect(real.updatePlaylist).toHaveBeenCalledWith(expect.objectContaining({ update: { field: "publish" } }), "synthetic-server-credential");
  });

  it("does not retry a failed field write", async () => {
    const { handlers, real, request } = setup();
    vi.mocked(real.updatePlaylist).mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE", "编辑未完成。", { retryable: true }));
    const result = await handlers.update(request("/api/playlists/801", {
      field: "name", value: "Changed", clientMutationId: "mutation-update-fail-001",
    }, "PATCH"), "801");
    expect(result.status).toBe(502);
    expect(real.updatePlaylist).toHaveBeenCalledTimes(1);
  });
});
