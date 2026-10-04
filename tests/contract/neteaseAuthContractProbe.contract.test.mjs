import { describe, expect, it, vi } from "vitest";

import {
  closeTransientQrServer,
  callResponse,
  createTemporaryPlaylistName,
  parseProbeArguments,
  probeStageMessage,
  runWriteScopes,
  summarizeWritePreflight,
  summarizeResponse,
  waitForCreatedComment,
} from "../../scripts/netease-auth-contract-probe.mjs";

describe("manual authenticated contract probe", () => {
  it("suppresses upstream logs while preserving only sanitized failed response metadata", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const records = [];

    await expect(callResponse(records, "playlist_subscribe:add", async () => {
      console.log("MUSIC_U=private-cookie");
      console.error("private upstream body");
      throw { status: 405, body: { code: 405, msg: "private upstream body" } };
    }, {})).rejects.toThrow("Manual probe request failed.");

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(records).toEqual([{
      endpoint: "playlist_subscribe:add",
      httpStatus: 405,
      businessCode: 405,
      fields: {},
    }]);
    log.mockRestore();
    error.mockRestore();
  });

  it("keeps temporary playlist names within the upstream length limit", () => {
    const name = createTemporaryPlaylistName();

    expect(name).toMatch(/^ECHOFORM-T020-[0-9a-f]{16}$/);
    expect(name.length).toBe(30);
    expect(name.length).toBeLessThanOrEqual(40);
  });

  it("requires an explicit live and write confirmation boundary", () => {
    expect(parseProbeArguments(["--live"])).toMatchObject({
      live: true,
      writes: false,
      writeScopes: [],
    });
    expect(() => parseProbeArguments(["--live", "--writes"])).toThrow(
      "External writes require both --writes and --confirm-external-writes.",
    );
    expect(() => parseProbeArguments([
      "--live",
      "--writes",
      "--confirm-external-writes",
      "--write-scope",
      "comment",
    ])).toThrow("Selected write scopes require --track-id.");
    expect(() => parseProbeArguments(["--live", "--preflight", "--writes", "--confirm-external-writes"]))
      .toThrow("--preflight cannot be combined with --writes.");
  });

  it("rejects unknown write scopes and requires identifiers only for selected mutations", () => {
    expect(() => parseProbeArguments([
      "--live",
      "--writes",
      "--confirm-external-writes",
      "--write-scope",
      "unknown",
    ])).toThrow("Unknown write scope.");
    expect(parseProbeArguments([
      "--live",
      "--writes",
      "--confirm-external-writes",
      "--write-scope",
      "like,playlist",
      "--track-id",
      "123456",
      "--qr-port",
      "4820",
    ])).toMatchObject({
      writes: true,
      writeScopes: ["like", "playlist"],
      trackId: "123456",
      qrPort: 4820,
    });
  });

  it("permits authorized internal candidate selection only for explicit write scopes", () => {
    expect(parseProbeArguments([
      "--live",
      "--writes",
      "--confirm-external-writes",
      "--auto-select-candidates",
      "--write-scope",
      "like,comment,playlist,collection,album",
    ])).toMatchObject({
      writes: true,
      autoSelectCandidates: true,
      writeScopes: ["like", "comment", "playlist", "collection", "album"],
      trackId: null,
      albumId: null,
      playlistId: null,
    });
    expect(() => parseProbeArguments(["--live", "--auto-select-candidates"]))
      .toThrow("--auto-select-candidates requires --writes.");
  });

  it("reports only allowed response metadata and never field values", () => {
    const sensitiveCookie = "MUSIC_U=private-cookie";
    const privateNickname = "private-nickname";
    const privateUrl = "https://example.invalid/private-audio";
    const report = summarizeResponse("recommend_songs", {
      status: 200,
      body: {
        code: 200,
        cookie: sensitiveCookie,
        data: {
          dailySongs: [{ name: privateNickname, url: privateUrl }],
        },
      },
    }, [{ label: "data.dailySongs", path: ["data", "dailySongs"], count: true }]);
    const serialized = JSON.stringify(report);

    expect(report).toEqual({
      endpoint: "recommend_songs",
      httpStatus: 200,
      businessCode: 200,
      fields: { "data.dailySongs": { present: true, count: 1 } },
    });
    expect(serialized).not.toContain(sensitiveCookie);
    expect(serialized).not.toContain(privateNickname);
    expect(serialized).not.toContain(privateUrl);
  });

  it("reads the Legacy nested login-status envelope without exposing account data", () => {
    const privateNickname = "private-nickname";
    const report = summarizeResponse("login_status", {
      status: 200,
      body: {
        data: {
          code: 200,
          account: { id: 123456 },
          profile: { nickname: privateNickname },
        },
      },
    }, {
      businessCodePath: ["data", "code"],
      fields: [
        { label: "data.account", path: ["data", "account"] },
        { label: "data.profile", path: ["data", "profile"] },
      ],
    });

    expect(report).toEqual({
      endpoint: "login_status",
      httpStatus: 200,
      businessCode: 200,
      fields: {
        "data.account": { present: true },
        "data.profile": { present: true },
      },
    });
    expect(JSON.stringify(report)).not.toContain(privateNickname);
  });

  it("reads the Legacy root user-account envelope without exposing account data", () => {
    const privateNickname = "private-nickname";
    const report = summarizeResponse("user_account", {
      status: 200,
      body: {
        code: 200,
        account: { id: 123456 },
        profile: { nickname: privateNickname },
      },
    }, [
      { label: "account", path: ["account"] },
      { label: "profile", path: ["profile"] },
    ]);

    expect(report).toEqual({
      endpoint: "user_account",
      httpStatus: 200,
      businessCode: 200,
      fields: {
        account: { present: true },
        profile: { present: true },
      },
    });
    expect(JSON.stringify(report)).not.toContain(privateNickname);
  });

  it("does not report empty QR cookies as authorized session data", () => {
    const fields = [{ label: "cookie", path: ["cookie"], nonEmptyText: true }];

    expect(summarizeResponse("login_qr_check", {
      status: 200,
      body: { code: 801, cookie: "" },
    }, fields)).toMatchObject({
      businessCode: 801,
      fields: { cookie: { present: false } },
    });
    expect(summarizeResponse("login_qr_check", {
      status: 200,
      body: { code: 803, cookie: "MUSIC_U=private-cookie" },
    }, fields)).toMatchObject({
      businessCode: 803,
      fields: { cookie: { present: true } },
    });
  });

  it("uses fixed, non-sensitive progress messages for manual probe stages", () => {
    expect(probeStageMessage("qr_scanned")).toBe(
      "QR scanned. Confirm the login on the test device.",
    );
    expect(probeStageMessage("unexpected-stage")).toBe("Probe stopped before completion.");
    expect(probeStageMessage("qr_scanned")).not.toContain("cookie");
  });

  it("force-closes idle QR page connections after stopping the transient server", async () => {
    const calls = [];
    await closeTransientQrServer({
      close: (callback) => {
        calls.push("close");
        callback();
      },
      closeAllConnections: () => {
        calls.push("closeAllConnections");
      },
    });

    expect(calls).toEqual(["close", "closeAllConnections"]);
  });

  it("reports only candidate availability for read-only write preflight", () => {
    const report = summarizeWritePreflight("collection", true);

    expect(report).toEqual({
      endpoint: "write_preflight:collection",
      httpStatus: null,
      businessCode: null,
      fields: { candidate: { present: true } },
    });
    expect(JSON.stringify(report)).not.toContain("playlistId");
  });

  it("stops before rollback when a mutation reports a non-200 business code", async () => {
    const calls = [];
    const api = {
      likelist: async () => ({ status: 200, body: { code: 200, ids: [] } }),
      like: async ({ like }) => {
        calls.push(like ? "add" : "remove");
        return { status: 200, body: { code: like ? 500 : 200 } };
      },
    };

    await expect(runWriteScopes(api, {
      writeScopes: ["like"],
      trackId: "123456",
    }, "private-cookie", "654321", [])).rejects.toThrow(
      "Manual probe business code did not match the contract.",
    );
    expect(calls).toEqual(["add"]);
  });

  it("accepts the Legacy nested playlist-track success envelope before rollback", async () => {
    const calls = [];
    const api = {
      playlist_create: async () => ({
        status: 200,
        body: { code: 200, playlist: { id: 123456 } },
      }),
      playlist_tracks: async ({ op }) => {
        calls.push(op);
        return { status: 200, body: { body: { code: 200 } } };
      },
      playlist_delete: async () => {
        calls.push("delete");
        return { status: 200, body: { code: 200 } };
      },
    };
    const records = [];

    await expect(runWriteScopes(api, {
      writeScopes: ["playlist"],
      trackId: "123456",
    }, "private-cookie", "654321", records)).resolves.toBeUndefined();

    expect(calls).toEqual(["add", "del", "delete"]);
    expect(records.find((record) => record.endpoint === "playlist_tracks:add")).toMatchObject({
      businessCode: 200,
    });
  });

  it("waits until a temporary comment is visible before selecting its rollback ID", async () => {
    const privateContent = "ECHOFORM-T020-private-content";
    const records = [];
    let reads = 0;
    const id = await waitForCreatedComment({
      comment_music: async () => {
        reads += 1;
        return {
          status: 200,
          body: {
            code: 200,
            comments: reads === 1 ? [] : [{ commentId: 2468, content: privateContent }],
          },
        };
      },
    }, "private-cookie", "123456", privateContent, records, async () => {});

    expect(id).toBe("2468");
    expect(reads).toBe(2);
    expect(JSON.stringify(records)).not.toContain(privateContent);
  });
});
