import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const legacyPackageName = "NeteaseCloudMusicApi";
const legacyVersion = "4.32.0";
const defaultTimeoutMs = 150_000;
const pollIntervalMs = 1_500;

const probeStageMessages = {
  creating_qr: "Creating a temporary QR challenge.",
  awaiting_scan: "QR ready. Waiting for scan and confirmation.",
  qr_waiting: "QR is waiting to be scanned.",
  qr_scanned: "QR scanned. Confirm the login on the test device.",
  qr_authorized: "QR authorized. Verifying the authenticated session.",
  login_status: "Reading authenticated login status.",
  user_account: "Reading authenticated account metadata.",
  recommend_songs: "Reading personal daily recommendations.",
  user_playlist: "Reading authenticated playlist metadata.",
  preflight: "Checking write preflight candidates without changing data.",
  writes: "Running explicitly authorized write probes.",
  closing: "Clearing the temporary session and logging out.",
};

const readMethodNames = [
  "login_qr_key",
  "login_qr_create",
  "login_qr_check",
  "login_status",
  "user_account",
  "recommend_songs",
  "top_playlist",
  "user_playlist",
];

const writeMethodNames = [
  "album_sub",
  "album_sublist",
  "comment",
  "comment_music",
  "like",
  "likelist",
  "playlist_create",
  "playlist_delete",
  "playlist_subscribe",
  "playlist_tracks",
];

const writeScopes = new Set(["like", "comment", "playlist", "collection", "album"]);

const qrKeyFields = [{ label: "data.unikey", path: ["data", "unikey"] }];
const qrImageFields = [{ label: "data.qrimg", path: ["data", "qrimg"] }];
const qrCheckFields = [{ label: "cookie", path: ["cookie"], nonEmptyText: true }];
const sessionFields = [
  { label: "data.account", path: ["data", "account"] },
  { label: "data.profile", path: ["data", "profile"] },
];
const accountFields = [
  { label: "account", path: ["account"] },
  { label: "profile", path: ["profile"] },
];
const recommendationFields = [
  { label: "data.dailySongs", path: ["data", "dailySongs"], count: true },
  { label: "recommend", path: ["recommend"], count: true },
];
const playlistFields = [
  { label: "playlist", path: ["playlist"], count: true },
  { label: "playlists", path: ["playlists"], count: true },
];
const playlistTrackCodePaths = [
  ["code"],
  ["body", "code"],
  ["data", "code"],
  ["body", "data", "code"],
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function probeStageMessage(stage) {
  return probeStageMessages[stage] ?? "Probe stopped before completion.";
}

export function summarizeWritePreflight(scope, candidateAvailable) {
  return {
    endpoint: `write_preflight:${scope}`,
    httpStatus: null,
    businessCode: null,
    fields: {
      candidate: { present: candidateAvailable },
    },
  };
}

function reportProbeStage(stage) {
  process.stderr.write(`[probe] ${probeStageMessage(stage)}\n`);
}

function getPath(value, path) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function bodyOf(response) {
  return isRecord(response?.body) ? response.body : {};
}

function responseCode(response, businessCodePath = ["code"]) {
  return finiteNumber(getPath(bodyOf(response), businessCodePath));
}

function responseCodeAtPaths(response, businessCodePaths) {
  for (const businessCodePath of businessCodePaths) {
    const code = responseCode(response, businessCodePath);
    if (code !== null) {
      return code;
    }
  }
  return null;
}

function fieldSummary(value, count, nonEmptyText) {
  if (Array.isArray(value)) {
    return { present: true, ...(count ? { count: value.length } : {}) };
  }
  if (nonEmptyText) {
    return { present: typeof value === "string" && value.trim().length > 0 };
  }
  return { present: value !== undefined && value !== null };
}

function summaryOptions(value) {
  if (Array.isArray(value)) {
    return { fields: value, businessCodePath: ["code"] };
  }
  return {
    fields: Array.isArray(value?.fields) ? value.fields : [],
    businessCodePath: Array.isArray(value?.businessCodePath)
      ? value.businessCodePath
      : ["code"],
    businessCodePaths: Array.isArray(value?.businessCodePaths)
      ? value.businessCodePaths
      : null,
  };
}

export function summarizeResponse(endpoint, response, options = []) {
  const body = bodyOf(response);
  const { fields, businessCodePath, businessCodePaths } = summaryOptions(options);
  return {
    endpoint,
    httpStatus: finiteNumber(response?.status),
    businessCode: businessCodePaths
      ? responseCodeAtPaths(response, businessCodePaths)
      : finiteNumber(getPath(body, businessCodePath)),
    fields: Object.fromEntries(fields.map((field) => [
      field.label,
      fieldSummary(getPath(body, field.path), field.count === true, field.nonEmptyText === true),
    ])),
  };
}

function failedResponse(endpoint, fields) {
  return summarizeResponse(endpoint, undefined, fields);
}

function requireArgumentValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function numericId(value, flag) {
  if (!/^\d{1,20}$/.test(value)) {
    throw new Error(`${flag} must be a public numeric identifier.`);
  }
  return value;
}

export function parseProbeArguments(argv) {
  const options = {
    live: false,
    writes: false,
    preflight: false,
    autoSelectCandidates: false,
    confirmExternalWrites: false,
    writeScopes: [],
    trackId: null,
    albumId: null,
    playlistId: null,
    qrPort: 0,
    timeoutMs: defaultTimeoutMs,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--live") {
      options.live = true;
    } else if (flag === "--preflight") {
      options.preflight = true;
    } else if (flag === "--auto-select-candidates") {
      options.autoSelectCandidates = true;
    } else if (flag === "--writes") {
      options.writes = true;
    } else if (flag === "--confirm-external-writes") {
      options.confirmExternalWrites = true;
    } else if (flag === "--write-scope") {
      const value = requireArgumentValue(argv, index, flag);
      index += 1;
      options.writeScopes = value.split(",").filter(Boolean);
    } else if (flag === "--track-id") {
      const value = requireArgumentValue(argv, index, flag);
      index += 1;
      options.trackId = numericId(value, flag);
    } else if (flag === "--album-id") {
      const value = requireArgumentValue(argv, index, flag);
      index += 1;
      options.albumId = numericId(value, flag);
    } else if (flag === "--playlist-id") {
      const value = requireArgumentValue(argv, index, flag);
      index += 1;
      options.playlistId = numericId(value, flag);
    } else if (flag === "--qr-port") {
      const value = Number(requireArgumentValue(argv, index, flag));
      index += 1;
      if (!Number.isInteger(value) || value < 0 || value > 65_535) {
        throw new Error("--qr-port must be an integer between 0 and 65535.");
      }
      options.qrPort = value;
    } else if (flag === "--timeout-ms") {
      const value = Number(requireArgumentValue(argv, index, flag));
      index += 1;
      if (!Number.isInteger(value) || value < 30_000 || value > 300_000) {
        throw new Error("--timeout-ms must be an integer between 30000 and 300000.");
      }
      options.timeoutMs = value;
    } else {
      throw new Error("Unknown probe argument.");
    }
  }

  if (options.writes !== options.confirmExternalWrites) {
    throw new Error("External writes require both --writes and --confirm-external-writes.");
  }
  if (options.writes && options.preflight) {
    throw new Error("--preflight cannot be combined with --writes.");
  }
  if (options.autoSelectCandidates && !options.writes) {
    throw new Error("--auto-select-candidates requires --writes.");
  }
  if (options.writes && options.writeScopes.length === 0) {
    throw new Error("External writes require at least one --write-scope.");
  }
  if (!options.writes && options.writeScopes.length > 0) {
    throw new Error("--write-scope requires --writes.");
  }
  if (options.writeScopes.some((scope) => !writeScopes.has(scope))) {
    throw new Error("Unknown write scope.");
  }
  if (options.writeScopes.some((scope) => ["like", "comment", "playlist"].includes(scope))
    && !options.trackId && !options.autoSelectCandidates) {
    throw new Error("Selected write scopes require --track-id.");
  }
  if (options.writeScopes.includes("collection") && !options.playlistId && !options.autoSelectCandidates) {
    throw new Error("collection scope requires --playlist-id.");
  }
  if (options.writeScopes.includes("album") && !options.albumId && !options.autoSelectCandidates) {
    throw new Error("album scope requires --album-id.");
  }
  return options;
}

function loadLegacyApi() {
  const require = createRequire(import.meta.url);
  const packageMetadata = require(`${legacyPackageName}/package.json`);
  if (packageMetadata.version !== legacyVersion) {
    throw new Error("Pinned Legacy package version is unavailable.");
  }
  const candidate = require(legacyPackageName);
  const methodNames = [...readMethodNames, ...writeMethodNames];
  if (!isRecord(candidate) || methodNames.some((name) => typeof candidate[name] !== "function")) {
    throw new Error("Pinned Legacy package method set is unavailable.");
  }
  return candidate;
}

export async function suppressUpstreamLogs(operation) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await operation();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

export function callResponse(records, endpoint, method, params, fields = []) {
  return suppressUpstreamLogs(() => method(params)).then((response) => {
    records.push(summarizeResponse(endpoint, response, fields));
    return response;
  }).catch((error) => {
    records.push(summarizeResponse(endpoint, error, fields));
    throw new Error("Manual probe request failed.");
  });
}

function requireCode(response, expectedCode = 200, businessCodePath = ["code"]) {
  if (responseCode(response, businessCodePath) !== expectedCode) {
    throw new Error("Manual probe business code did not match the contract.");
  }
}

function requireCodeAtPaths(response, expectedCode, businessCodePaths) {
  if (responseCodeAtPaths(response, businessCodePaths) !== expectedCode) {
    throw new Error("Manual probe business code did not match the contract.");
  }
}

function cookieFrom(response) {
  const bodyCookie = text(getPath(bodyOf(response), ["cookie"]));
  if (bodyCookie) {
    return bodyCookie;
  }
  const responseCookie = response?.cookie;
  if (typeof responseCookie === "string" && responseCookie) {
    return responseCookie;
  }
  if (Array.isArray(responseCookie) && responseCookie.every((item) => typeof item === "string")) {
    return responseCookie.join(";");
  }
  return null;
}

function userIdFrom(response) {
  const candidatePaths = [
    ["profile", "userId"],
    ["account", "id"],
    ["data", "profile", "userId"],
    ["data", "account", "id"],
  ];
  for (const path of candidatePaths) {
    const value = getPath(bodyOf(response), path);
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return String(value);
    }
    if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function qrImageFrom(response) {
  const image = text(getPath(bodyOf(response), ["data", "qrimg"]));
  return image?.startsWith("data:image/") ? image : null;
}

function qrKeyFrom(response) {
  return text(getPath(bodyOf(response), ["data", "unikey"]));
}

function htmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}

export function closeTransientQrServer(server) {
  return new Promise((resolvePromise) => {
    server.close(resolvePromise);
    server.closeAllConnections?.();
  });
}

export async function createTransientQrPage(port) {
  let imageDataUrl = null;
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/") {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const waitingForImage = imageDataUrl === null;
    response.writeHead(200, {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; img-src data:",
      "Content-Type": "text/html; charset=utf-8",
      ...(waitingForImage ? { Refresh: "1" } : {}),
    });
    response.end(waitingForImage
      ? "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>Test login</title><body>Preparing temporary test QR code.</body></html>"
      : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Test login</title><body><img alt="Test login QR" src="${htmlAttribute(imageDataUrl)}"></body></html>`);
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Transient QR page could not start.");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    setImage: (nextImageDataUrl) => {
      imageDataUrl = nextImageDataUrl;
    },
    close: () => closeTransientQrServer(server),
  };
}

function sleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

async function pollForAuthorization(api, key, timeoutMs, records, onStage) {
  const deadline = Date.now() + timeoutMs;
  let lastBusinessCode = null;
  while (Date.now() < deadline) {
    let response;
    try {
      response = await suppressUpstreamLogs(
        () => api.login_qr_check({ key, timestamp: Date.now() }),
      );
    } catch {
      records.push(failedResponse("login_qr_check", qrCheckFields));
      throw new Error("QR polling failed.");
    }
    const businessCode = responseCode(response);
    if (businessCode !== lastBusinessCode) {
      records.push(summarizeResponse("login_qr_check", response, qrCheckFields));
      lastBusinessCode = businessCode;
      if (businessCode === 801) {
        onStage?.("qr_waiting");
      } else if (businessCode === 802) {
        onStage?.("qr_scanned");
      } else if (businessCode === 803) {
        onStage?.("qr_authorized");
      }
    }
    if (businessCode === 803) {
      const upstreamCookie = cookieFrom(response);
      if (!upstreamCookie) {
        throw new Error("Authorized QR response omitted an in-memory cookie.");
      }
      return upstreamCookie;
    }
    if (businessCode === 800) {
      throw new Error("QR challenge expired.");
    }
    await sleep(pollIntervalMs);
  }
  throw new Error("QR polling timed out.");
}

function arraysIn(response, paths) {
  for (const path of paths) {
    const value = getPath(bodyOf(response), path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function entityId(value) {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value.id ?? value.playlistId ?? value.commentId ?? value.albumId;
  if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
    return String(candidate);
  }
  return typeof candidate === "string" && /^\d{1,20}$/.test(candidate) ? candidate : null;
}

function idFromValue(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
    return value;
  }
  return entityId(value);
}

function idsFrom(response, paths) {
  const rows = arraysIn(response, paths);
  if (!rows) {
    throw new Error("Existing state could not be verified before mutation.");
  }
  return new Set(rows.flatMap((row) => {
    const id = idFromValue(row);
    return id ? [id] : [];
  }));
}

function firstCandidateId(response, paths, excludedIds = new Set()) {
  const rows = arraysIn(response, paths);
  if (!rows) {
    return null;
  }
  for (const row of rows) {
    const id = idFromValue(row);
    if (id && !excludedIds.has(id)) {
      return id;
    }
  }
  return null;
}

function albumIdFromFirstRecommendation(response, excludedIds = new Set()) {
  const rows = arraysIn(response, [["data", "dailySongs"], ["recommend"]]);
  if (!rows) {
    return null;
  }
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const albumId = entityId(row.al ?? row.album);
    if (albumId && !excludedIds.has(albumId)) {
      return albumId;
    }
  }
  return null;
}

function listContainsId(response, paths, id) {
  const rows = arraysIn(response, paths);
  if (!rows) {
    throw new Error("Existing state could not be verified before mutation.");
  }
  return rows.some((row) => entityId(row) === id);
}

function findCommentId(response, content) {
  const rows = arraysIn(response, [["comments"], ["data", "comments"]]);
  if (!rows) {
    return null;
  }
  const comment = rows.find((row) => isRecord(row) && row.content === content);
  return entityId(comment);
}

function findPlaylistId(response, name) {
  const rows = arraysIn(response, [["playlist"], ["playlists"]]);
  if (!rows) {
    return null;
  }
  const playlist = rows.find((row) => isRecord(row) && row.name === name);
  return entityId(playlist);
}

export function createTemporaryPlaylistName() {
  return `ECHOFORM-T020-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export async function waitForCreatedComment(
  api,
  cookie,
  trackId,
  content,
  records,
  pause = sleep,
) {
  const attempts = 4;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const page = await callResponse(records, "comment_music:rollback_lookup", api.comment_music, {
      id: trackId,
      limit: 100,
      offset: 0,
      cookie,
      timestamp: Date.now(),
    }, [{ label: "comments", path: ["comments"], count: true }]);
    const commentId = findCommentId(page, content);
    if (commentId) {
      return commentId;
    }
    if (attempt < attempts - 1) {
      await pause(pollIntervalMs);
    }
  }
  return null;
}

export async function runWriteScopes(api, config, upstreamCookie, userId, records) {
  const cookie = upstreamCookie;
  for (const scope of config.writeScopes) {
    if (scope === "like") {
      const existing = await callResponse(records, "likelist", api.likelist, {
        uid: userId,
        cookie,
        timestamp: Date.now(),
      }, [{ label: "ids", path: ["ids"], count: true }]);
      if (listContainsId(existing, [["ids"]], config.trackId)) {
        throw new Error("Test track is already liked; refusing to alter existing state.");
      }
      const added = await callResponse(records, "like:add", api.like, {
        id: config.trackId,
        like: true,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(added);
      const rollback = await callResponse(records, "like:remove", api.like, {
        id: config.trackId,
        like: false,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(rollback);
    }

    if (scope === "comment") {
      const content = `ECHOFORM-T020-${randomUUID()}`;
      const added = await callResponse(records, "comment:add", api.comment, {
        t: 1,
        type: 0,
        id: config.trackId,
        content,
        cookie,
        timestamp: Date.now(),
      }, [{ label: "comment", path: ["comment"] }]);
      requireCode(added);
      const commentId = await waitForCreatedComment(
        api,
        cookie,
        config.trackId,
        content,
        records,
      );
      if (!commentId) {
        throw new Error("Temporary comment cannot be safely rolled back.");
      }
      const rollback = await callResponse(records, "comment:delete", api.comment, {
        t: 0,
        type: 0,
        id: config.trackId,
        commentId,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(rollback);
    }

    if (scope === "playlist") {
      const name = createTemporaryPlaylistName();
      const created = await callResponse(records, "playlist_create", api.playlist_create, {
        name,
        privacy: "0",
        type: "NORMAL",
        cookie,
        timestamp: Date.now(),
      }, [{ label: "playlist", path: ["playlist"] }]);
      requireCode(created);
      let playlistId = entityId(getPath(bodyOf(created), ["playlist"]));
      if (!playlistId) {
        const playlists = await callResponse(records, "user_playlist:rollback_lookup", api.user_playlist, {
          uid: userId,
          limit: 100,
          offset: 0,
          cookie,
          timestamp: Date.now(),
        }, playlistFields);
        playlistId = findPlaylistId(playlists, name);
      }
      if (!playlistId) {
        throw new Error("Temporary playlist cannot be safely rolled back.");
      }
      try {
        const added = await callResponse(records, "playlist_tracks:add", api.playlist_tracks, {
          op: "add",
          pid: playlistId,
          tracks: config.trackId,
          cookie,
          timestamp: Date.now(),
        }, { businessCodePaths: playlistTrackCodePaths });
        requireCodeAtPaths(added, 200, playlistTrackCodePaths);
        const removed = await callResponse(records, "playlist_tracks:remove", api.playlist_tracks, {
          op: "del",
          pid: playlistId,
          tracks: config.trackId,
          cookie,
          timestamp: Date.now(),
        }, { businessCodePaths: playlistTrackCodePaths });
        requireCodeAtPaths(removed, 200, playlistTrackCodePaths);
      } finally {
        const rollback = await callResponse(records, "playlist_delete", api.playlist_delete, {
          id: playlistId,
          cookie,
          timestamp: Date.now(),
        });
        requireCode(rollback);
      }
    }

    if (scope === "collection") {
      const playlists = await callResponse(records, "user_playlist:collection_preflight", api.user_playlist, {
        uid: userId,
        limit: 100,
        offset: 0,
        cookie,
        timestamp: Date.now(),
      }, playlistFields);
      requireCode(playlists);
      if (listContainsId(playlists, [["playlist"], ["playlists"]], config.playlistId)) {
        throw new Error("Test playlist is already collected; refusing to alter existing state.");
      }
      const added = await callResponse(records, "playlist_subscribe:add", api.playlist_subscribe, {
        id: config.playlistId,
        t: 1,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(added);
      const rollback = await callResponse(records, "playlist_subscribe:remove", api.playlist_subscribe, {
        id: config.playlistId,
        t: 2,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(rollback);
    }

    if (scope === "album") {
      const albums = await callResponse(records, "album_sublist", api.album_sublist, {
        limit: 100,
        offset: 0,
        cookie,
        timestamp: Date.now(),
      }, [{ label: "data", path: ["data"], count: true }]);
      requireCode(albums);
      if (listContainsId(albums, [["data"], ["data", "data"]], config.albumId)) {
        throw new Error("Test album is already collected; refusing to alter existing state.");
      }
      const added = await callResponse(records, "album_sub:add", api.album_sub, {
        id: config.albumId,
        t: 1,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(added);
      const rollback = await callResponse(records, "album_sub:remove", api.album_sub, {
        id: config.albumId,
        t: 0,
        cookie,
        timestamp: Date.now(),
      });
      requireCode(rollback);
    }
  }
}

async function resolveWriteCandidates(api, upstreamCookie, userId, recommendations, playlists, records) {
  const likes = await callResponse(records, "likelist:preflight", api.likelist, {
    uid: userId,
    cookie: upstreamCookie,
    timestamp: Date.now(),
  }, [{ label: "ids", path: ["ids"], count: true }]);
  requireCode(likes);
  const likedIds = idsFrom(likes, [["ids"]]);
  const trackId = firstCandidateId(
    recommendations,
    [["data", "dailySongs"], ["recommend"]],
    likedIds,
  );

  const albums = await callResponse(records, "album_sublist:preflight", api.album_sublist, {
    limit: 100,
    offset: 0,
    cookie: upstreamCookie,
    timestamp: Date.now(),
  }, [{ label: "data", path: ["data"], count: true }]);
  requireCode(albums);
  const albumIds = idsFrom(albums, [["data"], ["data", "data"]]);
  const albumId = albumIdFromFirstRecommendation(recommendations, albumIds);

  const publicPlaylists = await callResponse(records, "top_playlist:preflight", api.top_playlist, {
    cat: "全部",
    order: "hot",
    limit: 50,
    offset: 0,
    timestamp: Date.now(),
  }, playlistFields);
  requireCode(publicPlaylists);
  const currentPlaylistIds = idsFrom(playlists, [["playlist"], ["playlists"]]);
  const playlistId = firstCandidateId(publicPlaylists, [["playlists"], ["playlist"]], currentPlaylistIds);
  return { trackId, albumId, playlistId };
}

function assertAutoSelectedCandidates(config, candidates) {
  const missing = [];
  if (config.writeScopes.some((scope) => ["like", "comment", "playlist"].includes(scope))
    && !candidates.trackId) {
    missing.push("track");
  }
  if (config.writeScopes.includes("album") && !candidates.albumId) {
    missing.push("album");
  }
  if (config.writeScopes.includes("collection") && !candidates.playlistId) {
    missing.push("playlist");
  }
  if (missing.length > 0) {
    throw new Error("Auto-selected write candidates are unavailable.");
  }
}

async function runWritePreflight(api, upstreamCookie, userId, recommendations, playlists, records) {
  const candidates = await resolveWriteCandidates(
    api,
    upstreamCookie,
    userId,
    recommendations,
    playlists,
    records,
  );
  records.push(summarizeWritePreflight("like", Boolean(candidates.trackId)));
  records.push(summarizeWritePreflight("comment", Boolean(candidates.trackId)));
  records.push(summarizeWritePreflight("playlist", Boolean(candidates.trackId)));
  records.push(summarizeWritePreflight("album", Boolean(candidates.albumId)));
  records.push(summarizeWritePreflight("collection", Boolean(candidates.playlistId)));
  return candidates;
}

export async function startLiveProbeSession() {
  const api = loadLegacyApi();
  const records = [];
  const keyResponse = await callResponse(records, "login_qr_key", api.login_qr_key, {
    timestamp: Date.now(),
  }, qrKeyFields);
  requireCode(keyResponse);
  const key = qrKeyFrom(keyResponse);
  if (!key) {
    throw new Error("QR key is unavailable.");
  }
  const qrResponse = await callResponse(records, "login_qr_create", api.login_qr_create, {
    key,
    qrimg: true,
    timestamp: Date.now(),
  }, qrImageFields);
  requireCode(qrResponse);
  const qrImageDataUrl = qrImageFrom(qrResponse);
  if (!qrImageDataUrl) {
    throw new Error("QR image is unavailable.");
  }
  return {
    api,
    records,
    key,
    qrImageDataUrl,
    upstreamCookie: null,
    userId: null,
  };
}

export async function pollLiveProbeSession(session, timeoutMs = defaultTimeoutMs, onStage) {
  session.upstreamCookie = await pollForAuthorization(
    session.api,
    session.key,
    timeoutMs,
    session.records,
    onStage,
  );
  return { authorized: true };
}

export async function completeLiveProbeSession(session, config, onStage) {
  if (!session.upstreamCookie) {
    throw new Error("Probe session is not authorized.");
  }
  onStage?.("login_status");
  const loginStatus = await callResponse(session.records, "login_status", session.api.login_status, {
    cookie: session.upstreamCookie,
    timestamp: Date.now(),
  }, {
    fields: sessionFields,
    businessCodePath: ["data", "code"],
  });
  requireCode(loginStatus, 200, ["data", "code"]);
  onStage?.("user_account");
  const account = await callResponse(session.records, "user_account", session.api.user_account, {
    cookie: session.upstreamCookie,
    timestamp: Date.now(),
  }, accountFields);
  requireCode(account);
  const userId = userIdFrom(account) ?? userIdFrom(loginStatus);
  if (!userId) {
    throw new Error("Authenticated account did not expose a usable in-memory identifier.");
  }
  session.userId = userId;
  onStage?.("recommend_songs");
  const recommendations = await callResponse(session.records, "recommend_songs", session.api.recommend_songs, {
    cookie: session.upstreamCookie,
    timestamp: Date.now(),
  }, recommendationFields);
  requireCode(recommendations);
  onStage?.("user_playlist");
  const playlists = await callResponse(session.records, "user_playlist", session.api.user_playlist, {
    uid: userId,
    limit: 50,
    offset: 0,
    cookie: session.upstreamCookie,
    timestamp: Date.now(),
  }, playlistFields);
  requireCode(playlists);
  if (config.preflight) {
    onStage?.("preflight");
    await runWritePreflight(
      session.api,
      session.upstreamCookie,
      userId,
      recommendations,
      playlists,
      session.records,
    );
  }
  if (config.writes) {
    let writeConfig = config;
    if (config.autoSelectCandidates) {
      onStage?.("preflight");
      const candidates = await resolveWriteCandidates(
        session.api,
        session.upstreamCookie,
        userId,
        recommendations,
        playlists,
        session.records,
      );
      assertAutoSelectedCandidates(config, candidates);
      writeConfig = { ...config, ...candidates };
    }
    onStage?.("writes");
    await runWriteScopes(session.api, writeConfig, session.upstreamCookie, userId, session.records);
  }
}

export async function closeLiveProbeSession(session) {
  if (session.upstreamCookie) {
    try {
      await callResponse(session.records, "logout", session.api.logout, {
        cookie: session.upstreamCookie,
        timestamp: Date.now(),
      });
    } catch {
      // The failed logout response was already recorded in sanitized form.
    }
  }
  session.upstreamCookie = null;
  session.userId = null;
  session.key = null;
  session.qrImageDataUrl = null;
}

export async function runLiveProbe(config) {
  let session = null;
  let qrPage = null;
  let failed = false;
  let stage = "creating_qr";
  const setStage = (nextStage) => {
    stage = nextStage;
    reportProbeStage(stage);
  };
  try {
    setStage("creating_qr");
    session = await startLiveProbeSession();
    qrPage = await createTransientQrPage(config.qrPort);
    qrPage.setImage(session.qrImageDataUrl);
    process.stderr.write(`Open the temporary QR page with the dedicated test account: ${qrPage.url}\n`);
    setStage("awaiting_scan");
    await pollLiveProbeSession(session, config.timeoutMs, setStage);
    await completeLiveProbeSession(session, config, setStage);
  } catch {
    failed = true;
    process.stderr.write(`[probe] Stopped during ${stage}. The final report below is sanitized.\n`);
  } finally {
    reportProbeStage("closing");
    if (session) {
      await closeLiveProbeSession(session);
    }
    if (qrPage) {
      await qrPage.close();
    }
  }
  return { failed, records: session?.records ?? [] };
}

function isDirectExecution() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

async function main() {
  let config;
  try {
    config = parseProbeArguments(process.argv.slice(2));
  } catch {
    process.stderr.write("Probe arguments are invalid. No network request was made.\n");
    return 2;
  }
  if (!config.live) {
    process.stderr.write("Manual probe requires --live. No network request was made.\n");
    return 2;
  }
  const result = await runLiveProbe(config);
  process.stdout.write(`${JSON.stringify(result.records, null, 2)}\n`);
  return result.failed ? 1 : 0;
}

if (isDirectExecution()) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.exitCode = 1;
  });
}
