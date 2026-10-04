import { describe, expect, it, vi } from "vitest";

import {
  parseCommentProbeArguments,
  runCommentProbeScopes,
  selectCommentProbeTrack,
} from "../../scripts/netease-comment-interaction-probe.mjs";

const response = (code = 200) => ({ status: code, body: { code } });

function fixture(replyCode = 200, likeCode = 200) {
  const calls = [];
  const rows = [];
  let nextId = 801;
  return {
    calls,
    api: {
      comment_music: vi.fn(async () => ({ status: 200, body: { code: 200, comments: [...rows] } })),
      comment: vi.fn(async ({ t, commentId, content }) => {
        if (t === 1) {
          calls.push("parent:add");
          rows.push({ commentId: nextId++, content, liked: false });
        } else if (t === 2) {
          calls.push("reply:add");
          if (replyCode === 200) rows.push({ commentId: nextId++, content, liked: false });
          return response(replyCode);
        } else {
          calls.push(`comment:delete:${commentId}`);
          const index = rows.findIndex((row) => String(row.commentId) === commentId);
          if (index >= 0) rows.splice(index, 1);
        }
        return response();
      }),
      comment_like: vi.fn(async ({ t, cid }) => {
        calls.push(t === 1 ? "like:add" : "like:remove");
        const row = rows.find((item) => String(item.commentId) === cid);
        if (row) row.liked = t === 1 && likeCode === 200;
        return response(t === 1 ? likeCode : 200);
      }),
    },
  };
}

describe("manual T023 interaction probe", () => {
  it("requires explicit live scope, write confirmation, and a public track ID", () => {
    expect(() => parseCommentProbeArguments(["--live", "--write-scope", "reply", "--track-id", "101"]))
      .toThrow("explicit writes");
    expect(() => parseCommentProbeArguments([
      "--live", "--writes", "--confirm-external-writes", "--write-scope", "reply,reply", "--track-id", "101",
    ])).toThrow("explicit writes");
    expect(parseCommentProbeArguments([
      "--live", "--writes", "--confirm-external-writes", "--write-scope", "reply,comment-like", "--track-id", "101",
    ])).toMatchObject({ scopes: ["reply", "comment-like"], trackId: "101" });
    expect(parseCommentProbeArguments([
      "--live", "--writes", "--confirm-external-writes", "--write-scope", "reply", "--auto-select-candidate",
    ])).toMatchObject({ scopes: ["reply"], autoSelectCandidate: true });
    expect(() => parseCommentProbeArguments([
      "--live", "--writes", "--confirm-external-writes", "--write-scope", "reply", "--track-id", "101", "--auto-select-candidate",
    ])).toThrow("exactly one test track selection");
  });

  it("selects a daily song only through sanitized read preflight", async () => {
    const records = [];
    const api = {
      recommend_songs: vi.fn(async () => ({ status: 200, body: { code: 200, data: { dailySongs: [{ id: 101 }] } } })),
      comment_music: vi.fn(async () => ({ status: 200, body: { code: 200, comments: [] } })),
    };
    await expect(selectCommentProbeTrack(api, "private-cookie", records)).resolves.toBe("101");
    expect(JSON.stringify(records)).not.toContain("101");
    expect(JSON.stringify(records)).not.toContain("private-cookie");
  });

  it("deletes the reply then its temporary parent without reporting text or IDs", async () => {
    const { api, calls } = fixture();
    const records = [];
    await runCommentProbeScopes(api, { scopes: ["reply"], trackId: "101" }, "private-cookie", records);
    expect(calls).toEqual(["parent:add", "reply:add", "comment:delete:802", "comment:delete:801"]);
    expect(records.map((row) => row.endpoint)).toContain("reply:delete");
    expect(JSON.stringify(records)).not.toContain("ECHOFORM-T023-");
    expect(JSON.stringify(records)).not.toContain("private-cookie");
  });

  it("still deletes the temporary parent after a rejected reply", async () => {
    const { api, calls } = fixture(405);
    const records = [];
    await expect(runCommentProbeScopes(api, { scopes: ["reply"], trackId: "101" }, "private-cookie", records))
      .rejects.toThrow();
    expect(calls).toEqual(["parent:add", "reply:add", "comment:delete:801"]);
    expect(records.find((row) => row.endpoint === "reply:add")).toMatchObject({ businessCode: 405 });
  });

  it("cleans a parent that became visible despite a failed add response", async () => {
    const { api, calls } = fixture();
    const originalComment = api.comment;
    api.comment = vi.fn(async (params) => {
      const result = await originalComment(params);
      return params.t === 1 ? response(502) : result;
    });
    await expect(runCommentProbeScopes(api, { scopes: ["reply"], trackId: "101" }, "private-cookie", []))
      .rejects.toThrow();
    expect(calls).toEqual(["parent:add", "comment:delete:801"]);
  });

  it("removes a temporary like and then its comment, including after a failed add", async () => {
    const ok = fixture();
    await runCommentProbeScopes(ok.api, { scopes: ["comment-like"], trackId: "101" }, "private-cookie", []);
    expect(ok.calls).toEqual(["parent:add", "like:add", "like:remove", "comment:delete:801"]);

    const rejected = fixture(200, 405);
    const records = [];
    await expect(runCommentProbeScopes(rejected.api, { scopes: ["comment-like"], trackId: "101" }, "private-cookie", records))
      .rejects.toThrow();
    expect(rejected.calls).toEqual(["parent:add", "like:add", "like:remove", "comment:delete:801"]);
    expect(records.find((row) => row.endpoint === "comment-like:add")).toMatchObject({ businessCode: 405 });
  });
});
