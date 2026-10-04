import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  callResponse,
  closeLiveProbeSession,
  createTransientQrPage,
  pollLiveProbeSession,
  startLiveProbeSession,
  completeLiveProbeSession,
  waitForCreatedComment,
} from "./netease-auth-contract-probe.mjs";

const scopes = new Set(["reply", "comment-like"]);

export function parseCommentProbeArguments(args) {
  const config = { live: false, writes: false, confirmed: false, trackId: null, autoSelectCandidate: false, scopes: [], qrPort: 0 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--live") config.live = true;
    else if (flag === "--writes") config.writes = true;
    else if (flag === "--confirm-external-writes") config.confirmed = true;
    else if (flag === "--auto-select-candidate") config.autoSelectCandidate = true;
    else if (["--track-id", "--write-scope", "--qr-port"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Probe argument value is missing.");
      if (flag === "--track-id") {
        if (!/^\d{1,20}$/.test(value)) throw new Error("A numeric public test track ID is required.");
        config.trackId = value;
      } else if (flag === "--write-scope") config.scopes = value.split(",");
      else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid QR port.");
        config.qrPort = port;
      }
    } else throw new Error("Unknown probe argument.");
  }
  if (!config.live || !config.writes || !config.confirmed
    || Boolean(config.trackId) === config.autoSelectCandidate
    || config.scopes.length === 0 || config.scopes.some((scope) => !scopes.has(scope))
    || new Set(config.scopes).size !== config.scopes.length) {
    throw new Error("Live comment probes require explicit writes, scope, and exactly one test track selection.");
  }
  return config;
}

function requireSuccess(response) {
  if (response?.status !== 200 || response?.body?.code !== 200) {
    throw new Error("Manual probe business code did not match the contract.");
  }
}

function commentRows(response) {
  const body = response?.body;
  return Array.isArray(body?.comments) ? body.comments : null;
}

async function readCommentPage(api, cookie, trackId, records, endpoint) {
  const response = await callResponse(records, endpoint, api.comment_music, {
    id: trackId, limit: 100, offset: 0, cookie, timestamp: Date.now(),
  }, [{ label: "comments", path: ["comments"], count: true }]);
  requireSuccess(response);
  if (!commentRows(response)) throw new Error("Comment preflight returned no comment array.");
  return response;
}

async function deleteComment(api, cookie, trackId, commentId, records, endpoint) {
  const response = await callResponse(records, endpoint, api.comment, {
    t: 0, type: 0, id: trackId, commentId, cookie, timestamp: Date.now(),
  });
  requireSuccess(response);
}

async function withTemporaryComment(api, cookie, trackId, records, scope, operation) {
  await readCommentPage(api, cookie, trackId, records, `${scope}:preflight`);
  const content = `ECHOFORM-T023-${randomUUID()}`;
  let addError = null;
  try {
    const created = await callResponse(records, `${scope}:parent_add`, api.comment, {
      t: 1, type: 0, id: trackId, content, cookie, timestamp: Date.now(),
    });
    requireSuccess(created);
  } catch (error) {
    addError = error;
  }
  const parentId = await waitForCreatedComment(api, cookie, trackId, content, records);
  if (!parentId) throw addError ?? new Error("Temporary parent comment could not be located for cleanup.");
  try {
    if (addError) throw addError;
    await operation(parentId);
  } finally {
    await deleteComment(api, cookie, trackId, parentId, records, `${scope}:parent_delete`);
  }
}

async function probeReply(api, cookie, trackId, records) {
  await withTemporaryComment(api, cookie, trackId, records, "reply", async (parentId) => {
    const content = `ECHOFORM-T023-REPLY-${randomUUID()}`;
    let created = false;
    try {
      const response = await callResponse(records, "reply:add", api.comment, {
        t: 2, type: 0, id: trackId, commentId: parentId, content, cookie, timestamp: Date.now(),
      });
      requireSuccess(response);
      created = true;
    } finally {
      // Even an ambiguous add response can have committed; look up by the unique in-memory text.
      const replyId = await waitForCreatedComment(api, cookie, trackId, content, records);
      if (replyId) await deleteComment(api, cookie, trackId, replyId, records, "reply:delete");
      else if (created) throw new Error("Temporary reply could not be located for cleanup.");
    }
  });
}

async function probeCommentLike(api, cookie, trackId, records) {
  await withTemporaryComment(api, cookie, trackId, records, "comment-like", async (commentId) => {
    const initial = await readCommentPage(api, cookie, trackId, records, "comment-like:state_before");
    const row = commentRows(initial)?.find((item) => String(item?.commentId) === commentId);
    if (!row || row.liked === true) throw new Error("Temporary comment like preflight is unsafe.");
    try {
      const added = await callResponse(records, "comment-like:add", api.comment_like, {
        id: trackId, cid: commentId, type: 0, t: 1, cookie, timestamp: Date.now(),
      });
      requireSuccess(added);
    } finally {
      // This temporary comment had no prior like, so removing is the safe rollback.
      const removed = await callResponse(records, "comment-like:remove", api.comment_like, {
        id: trackId, cid: commentId, type: 0, t: 0, cookie, timestamp: Date.now(),
      });
      requireSuccess(removed);
    }
  });
}

export async function runCommentProbeScopes(api, config, cookie, records) {
  if (typeof api.comment !== "function" || typeof api.comment_music !== "function"
    || (config.scopes.includes("comment-like") && typeof api.comment_like !== "function")) {
    throw new Error("Pinned comment method set is unavailable.");
  }
  for (const scope of config.scopes) {
    if (scope === "reply") await probeReply(api, cookie, config.trackId, records);
    else await probeCommentLike(api, cookie, config.trackId, records);
  }
}

export async function selectCommentProbeTrack(api, cookie, records) {
  const response = await callResponse(records, "recommend_songs:track_select", api.recommend_songs, {
    cookie, timestamp: Date.now(),
  }, [{ label: "data.dailySongs", path: ["data", "dailySongs"], count: true }]);
  requireSuccess(response);
  const songs = response?.body?.data?.dailySongs;
  if (!Array.isArray(songs)) throw new Error("No daily recommendation candidates are available.");
  for (const song of songs) {
    const id = song?.id;
    const trackId = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : id;
    if (typeof trackId !== "string" || !/^\d{1,20}$/.test(trackId)) continue;
    await readCommentPage(api, cookie, trackId, records, "comment:track_preflight");
    return trackId;
  }
  throw new Error("No numeric daily recommendation candidate is available.");
}

async function runLive(config) {
  let session;
  let page;
  let failed = false;
  try {
    session = await startLiveProbeSession();
    page = await createTransientQrPage(config.qrPort);
    page.setImage(session.qrImageDataUrl);
    process.stderr.write(`Open the temporary QR page with the dedicated test account: ${page.url}\n`);
    await pollLiveProbeSession(session);
    await completeLiveProbeSession(session, { writes: false, preflight: false });
    const trackId = config.autoSelectCandidate
      ? await selectCommentProbeTrack(session.api, session.upstreamCookie, session.records)
      : config.trackId;
    await runCommentProbeScopes(session.api, { ...config, trackId }, session.upstreamCookie, session.records);
  } catch {
    failed = true;
    process.stderr.write("[probe] Stopped. Inspect the sanitized report for rollback status.\n");
  } finally {
    if (session) await closeLiveProbeSession(session);
    if (page) await page.close();
  }
  process.stdout.write(`${JSON.stringify(session?.records ?? [], null, 2)}\n`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runLive(parseCommentProbeArguments(process.argv.slice(2)));
  } catch {
    process.stderr.write("[probe] Invalid arguments. No network request was sent.\n");
    process.exitCode = 1;
  }
}
