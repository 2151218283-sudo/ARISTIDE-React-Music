import { describe, expect, it, vi } from "vitest";

import { runPlaylistManagementProbe } from "../../scripts/netease-playlist-management-probe.mjs";

function fixture({ failAt = null, ambiguousCreate = false } = {}) {
  const owner = { userId: 701, nickname: "Synthetic Owner" };
  const existing = { id: 800, name: "Existing Synthetic Playlist", creator: owner,
    specialType: 0, privacy: 0, trackCount: 12, tracks: Array(10).fill({ id: 101 }),
    trackIds: Array(12).fill({ id: 101 }) };
  const playlists = [existing];
  const calls = [];
  const response = (body) => ({ status: 200, body: { code: 200, ...body } });
  const method = (name, action) => vi.fn(async (input) => {
    calls.push({ name, input });
    return action(input);
  });
  const temporary = () => playlists.find((item) => item.id === 801);
  const api = {
    user_playlist: method("user_playlist", () => response({ playlist: structuredClone(playlists) })),
    playlist_detail: method("playlist_detail", ({ id, cookie }) => {
      const item = playlists.find((row) => String(row.id) === String(id));
      if (!item || (!cookie && item.privacy === 10)) return { status: 401, body: { code: 401 } };
      return response({ playlist: structuredClone(item) });
    }),
    playlist_track_all: method("playlist_track_all", () => response({ songs: Array(12).fill({ id: 101 }) })),
    playlist_create: method("playlist_create", ({ name, privacy }) => {
      playlists.push({ id: 801, name, creator: owner, specialType: 0, privacy,
        description: null, tags: [], trackCount: 0, tracks: [], trackIds: [] });
      return ambiguousCreate ? { status: 502, body: { code: 502 } } : response({ playlist: { id: 801 } });
    }),
    playlist_name_update: method("playlist_name_update", ({ name }) => {
      temporary().name = name;
      return response({});
    }),
    playlist_desc_update: method("playlist_desc_update", ({ desc }) => {
      temporary().description = desc;
      return response({});
    }),
    playlist_tags_update: method("playlist_tags_update", ({ tags }) => {
      if (failAt === "tags") return { status: 405, body: { code: 405 } };
      temporary().tags = [tags];
      return response({});
    }),
    playlist_privacy: method("playlist_privacy", () => {
      temporary().privacy = 0;
      return response({});
    }),
    playlist_delete: method("playlist_delete", ({ id }) => {
      const index = playlists.findIndex((row) => String(row.id) === String(id));
      if (index >= 0) playlists.splice(index, 1);
      return response({});
    }),
  };
  return { api, calls, playlists };
}

const options = { pause: async () => {}, createToken: () => "synthetic-token-01" };

describe("T022 playlist management manual probe", () => {
  it("verifies independent methods, cleans its own playlist, and reports no identities", async () => {
    const { api, calls, playlists } = fixture();
    const records = [];
    await runPlaylistManagementProbe(api, "synthetic-cookie", "701", records, options);
    expect(playlists).toHaveLength(1);
    expect(calls.filter((call) => call.name === "playlist_delete")).toHaveLength(1);
    expect(calls.map((call) => call.name)).toContain("playlist_privacy");
    expect(records).toContainEqual(expect.objectContaining({ endpoint: "playlist_cleanup",
      fields: { located: { present: true }, confirmed: { present: true } } }));
    const report = JSON.stringify(records);
    expect(report).not.toContain("synthetic-cookie");
    expect(report).not.toContain("ECHOFORM-T022");
    expect(report).not.toContain("801");
  });

  it("stops after an edit failure and still deletes the identified temporary playlist", async () => {
    const { api, calls, playlists } = fixture({ failAt: "tags" });
    const records = [];
    await expect(runPlaylistManagementProbe(api, "synthetic-cookie", "701", records, options))
      .rejects.toThrow("Upstream status did not confirm");
    expect(playlists).toHaveLength(1);
    expect(calls.filter((call) => call.name === "playlist_delete")).toHaveLength(1);
    expect(api.playlist_privacy).not.toHaveBeenCalled();
  });

  it("locates and cleans a created playlist even when creation returned a failure", async () => {
    const { api, calls, playlists } = fixture({ ambiguousCreate: true });
    const records = [];
    await expect(runPlaylistManagementProbe(api, "synthetic-cookie", "701", records, options))
      .rejects.toThrow("Upstream status did not confirm");
    expect(playlists).toHaveLength(1);
    expect(calls.filter((call) => call.name === "playlist_delete")).toHaveLength(1);
    expect(api.playlist_name_update).not.toHaveBeenCalled();
  });
});
