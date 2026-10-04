import { describe, expect, it, vi } from "vitest";

import { LegacyNeteaseAdapter } from "../../src/lib/music/netease/adapter";
import type { LegacyNeteaseApi } from "../../src/lib/music/netease/types";

const response = (body: unknown) => ({ status: 200, body });

describe("Legacy playlist adapter", () => {
  it("normalizes a detail page and uses the server credential only upstream", async () => {
    const playlist_detail = vi.fn(async () => response({
      code: 200,
      playlist: {
        id: 801, name: "Synthetic Playlist", privacy: 0, tags: ["Electronic"], specialType: 0, creator: { userId: 701, nickname: "Synthetic Owner" },
        tracks: [{ id: 101, name: "Synthetic Track", ar: [{ id: 201, name: "Artist" }], al: { id: 301, name: "Album" }, dt: 120000 }],
      },
    }));
    const adapter = new LegacyNeteaseAdapter({ playlist_detail } as unknown as LegacyNeteaseApi);
    const detail = await adapter.getPlaylist("801", "synthetic-server-credential");
    expect(detail).toMatchObject({ playlist: { id: "801", tags: ["Electronic"], owner: { id: "701" } }, tracks: [{ id: "101" }], canEdit: true });
    expect(JSON.stringify(detail)).not.toContain("credential");
    expect(playlist_detail).toHaveBeenCalledWith({ id: "801", cookie: "synthetic-server-credential" });
  });

  it("accepts a created playlist ID and the fixed package nested track envelope", async () => {
    const playlist_create = vi.fn(async () => response({ code: 200, playlist: { id: 801 } }));
    const playlist_tracks = vi.fn(async () => response({ body: { code: 200 } }));
    const adapter = new LegacyNeteaseAdapter({ playlist_create, playlist_tracks } as unknown as LegacyNeteaseApi);
    const created = await adapter.createPlaylist({ name: "Synthetic Playlist", visibility: "private", clientMutationId: "mutation-create-000001" }, "credential");
    expect(created).toMatchObject({ id: "801", name: "Synthetic Playlist", visibility: "private" });
    await expect(adapter.changePlaylistTracks({ playlistId: "801", trackIds: ["101"], operation: "add", clientMutationId: "mutation-add-00000001" }, "credential")).resolves.toBeUndefined();
    expect(playlist_tracks).toHaveBeenCalledTimes(1);
    expect(playlist_tracks).toHaveBeenCalledWith({ op: "add", pid: "801", tracks: "101", cookie: "credential" });
  });

  it("rejects a nested non-success code without retrying", async () => {
    const playlist_tracks = vi.fn(async () => response({ body: { code: 405 } }));
    const adapter = new LegacyNeteaseAdapter({ playlist_tracks } as unknown as LegacyNeteaseApi);
    await expect(adapter.changePlaylistTracks({ playlistId: "801", trackIds: ["101"], operation: "remove", clientMutationId: "mutation-remove-000001" }, "credential")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(playlist_tracks).toHaveBeenCalledTimes(1);
  });

  it("uses only verified separate edit methods and private-to-public publishing", async () => {
    const playlist_name_update = vi.fn(async () => response({ code: 200 }));
    const playlist_desc_update = vi.fn(async () => response({ code: 200 }));
    const playlist_tags_update = vi.fn(async () => response({ code: 200 }));
    const playlist_privacy = vi.fn(async () => response({ code: 200 }));
    const adapter = new LegacyNeteaseAdapter({
      playlist_name_update, playlist_desc_update, playlist_tags_update, playlist_privacy,
    } as unknown as LegacyNeteaseApi);
    const write = (update: { field: "name" | "description" | "tags" | "publish"; value?: string | string[] }) =>
      adapter.updatePlaylist({ playlistId: "801", update: update as Parameters<typeof adapter.updatePlaylist>[0]["update"], clientMutationId: "mutation-update-00001" }, "credential");
    await write({ field: "name", value: "Renamed" });
    await write({ field: "description", value: "Description" });
    await write({ field: "tags", value: ["Electronic", "Ambient"] });
    await write({ field: "publish" });
    expect(playlist_name_update).toHaveBeenCalledWith({ id: "801", name: "Renamed", cookie: "credential" });
    expect(playlist_desc_update).toHaveBeenCalledWith({ id: "801", desc: "Description", cookie: "credential" });
    expect(playlist_tags_update).toHaveBeenCalledWith({ id: "801", tags: "Electronic,Ambient", cookie: "credential" });
    expect(playlist_privacy).toHaveBeenCalledWith({ id: "801", cookie: "credential" });
  });

  it("rejects a failed independent edit without repeating it", async () => {
    const playlist_name_update = vi.fn(async () => ({ status: 405, body: { code: 405 } }));
    const adapter = new LegacyNeteaseAdapter({ playlist_name_update } as unknown as LegacyNeteaseApi);
    await expect(adapter.updatePlaylist({ playlistId: "801", update: { field: "name", value: "Renamed" }, clientMutationId: "mutation-update-00002" }, "credential"))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(playlist_name_update).toHaveBeenCalledTimes(1);
  });

  it("preserves requested private visibility when create omits privacy", async () => {
    const playlist_create = vi.fn(async () => response({ code: 200, playlist: { id: 801, name: "Private Signals" } }));
    const adapter = new LegacyNeteaseAdapter({ playlist_create } as unknown as LegacyNeteaseApi);
    const created = await adapter.createPlaylist({ name: "Private Signals", visibility: "private", clientMutationId: "mutation-private-00003" }, "credential");
    expect(created.visibility).toBe("private");
    expect(created.tags).toEqual([]);
  });
});
