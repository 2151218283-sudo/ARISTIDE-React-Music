import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  callResponse,
  closeLiveProbeSession,
  completeLiveProbeSession,
  createTransientQrPage,
  pollLiveProbeSession,
  startLiveProbeSession,
} from "./netease-auth-contract-probe.mjs";

const numericIdPattern = /^\d{1,20}$/;
const requiredMethods = [
  "playlist_create", "playlist_delete", "playlist_detail", "playlist_track_all",
  "playlist_name_update", "playlist_desc_update", "playlist_tags_update",
  "playlist_privacy", "user_playlist",
];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function body(response) {
  return record(response?.body) ?? {};
}

function entityId(value) {
  const id = record(value)?.id;
  if (typeof id === "number" && Number.isSafeInteger(id)) return String(id);
  return typeof id === "string" && numericIdPattern.test(id) ? id : null;
}

function ownerId(value) {
  const creator = record(record(value)?.creator);
  const id = creator?.userId ?? creator?.id;
  if (typeof id === "number" && Number.isSafeInteger(id)) return String(id);
  return typeof id === "string" && numericIdPattern.test(id) ? id : null;
}

function requireSuccess(response) {
  if (response?.status !== 200 || body(response).code !== 200) {
    throw new Error("Upstream status did not confirm the probe step.");
  }
}

function playlistRows(response) {
  requireSuccess(response);
  const rows = body(response).playlist;
  if (!Array.isArray(rows)) throw new Error("Playlist list shape is unavailable.");
  return rows;
}

function temporaryMatch(rows, names, userId) {
  return rows.find((row) => names.has(record(row)?.name) && ownerId(row) === userId && entityId(row));
}

async function listPlaylists(api, cookie, userId, records, endpoint) {
  const response = await callResponse(records, endpoint, api.user_playlist, {
    uid: userId, limit: 100, offset: 0, cookie, timestamp: Date.now(),
  }, [{ label: "playlist", path: ["playlist"], count: true }]);
  return playlistRows(response);
}

async function locateTemporary(api, cookie, userId, names, records, pause) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await listPlaylists(api, cookie, userId, records, "user_playlist:temporary_lookup");
    const match = temporaryMatch(rows, names, userId);
    if (match) return entityId(match);
    if (attempt < 3) await pause(1_500);
  }
  return null;
}

async function readDetail(api, cookie, id, records, endpoint) {
  const response = await callResponse(records, endpoint, api.playlist_detail, {
    id, ...(cookie ? { cookie } : {}), timestamp: Date.now(),
  }, [{ label: "playlist", path: ["playlist"] }]);
  requireSuccess(response);
  const playlist = record(body(response).playlist);
  if (!playlist || entityId(playlist) !== id) throw new Error("Playlist detail shape is unavailable.");
  return playlist;
}

function count(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function readExistingDetail(api, cookie, userId, rows, records) {
  const candidate = rows
    .filter((row) => ownerId(row) === userId && count(record(row)?.trackCount) > 0)
    .sort((left, right) => (count(record(left)?.trackCount) ?? 0) - (count(record(right)?.trackCount) ?? 0))[0];
  if (!candidate) {
    records.push({ endpoint: "playlist_detail:existing_candidate", httpStatus: null, businessCode: null,
      fields: { available: { present: false } } });
    return;
  }
  const id = entityId(candidate);
  if (!id) throw new Error("Existing playlist candidate has no usable ID.");
  const detail = await readDetail(api, cookie, id, records, "playlist_detail:existing");
  const trackCount = count(detail.trackCount);
  const embeddedCount = Array.isArray(detail.tracks) ? detail.tracks.length : null;
  const trackIdsCount = Array.isArray(detail.trackIds) ? detail.trackIds.length : null;
  records.push({ endpoint: "playlist_detail:existing_counts", httpStatus: null, businessCode: null,
    fields: {
      trackCount: { present: trackCount !== null, ...(trackCount !== null ? { count: trackCount } : {}) },
      embeddedTracks: { present: embeddedCount !== null, ...(embeddedCount !== null ? { count: embeddedCount } : {}) },
      trackIds: { present: trackIdsCount !== null, ...(trackIdsCount !== null ? { count: trackIdsCount } : {}) },
    } });
  const limit = Math.min(trackCount ?? 50, 50);
  if (limit === 0) return;
  const all = await callResponse(records, "playlist_track_all:existing", api.playlist_track_all, {
    id, limit, offset: 0, cookie, timestamp: Date.now(),
  }, [{ label: "songs", path: ["songs"], count: true }]);
  requireSuccess(all);
}

function assertTemporaryDetail(playlist, id, userId, expected) {
  if (entityId(playlist) !== id || ownerId(playlist) !== userId || playlist.privacy !== expected.privacy
    || playlist.name !== expected.name) {
    throw new Error("Temporary playlist state did not match the requested write.");
  }
  if (expected.description !== undefined && playlist.description !== expected.description) {
    throw new Error("Temporary playlist description was not confirmed.");
  }
  if (expected.tag !== undefined && (!Array.isArray(playlist.tags) || !playlist.tags.includes(expected.tag))) {
    throw new Error("Temporary playlist tag was not confirmed.");
  }
}

async function confirmTemporaryDetail(api, cookie, id, userId, expected, records, pause, endpoint) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const detail = await readDetail(api, cookie, id, records, endpoint);
    try {
      assertTemporaryDetail(detail, id, userId, expected);
      return detail;
    } catch (error) {
      if (attempt === 3) throw error;
      await pause(1_500);
    }
  }
  throw new Error("Temporary playlist detail was not confirmed.");
}

async function cleanupTemporary(api, cookie, userId, names, records, pause, attemptedCreation) {
  if (!attemptedCreation) return true;
  let id;
  try {
    id = await locateTemporary(api, cookie, userId, names, records, pause);
  } catch {
    records.push({ endpoint: "playlist_cleanup", httpStatus: null, businessCode: null,
      fields: { located: { present: false }, confirmed: { present: false } } });
    return false;
  }
  if (!id) {
    records.push({ endpoint: "playlist_cleanup", httpStatus: null, businessCode: null,
      fields: { located: { present: false }, confirmed: { present: false } } });
    return false;
  }
  try {
    const deletion = await callResponse(records, "playlist_delete:rollback", api.playlist_delete, {
      id, cookie, timestamp: Date.now(),
    });
    requireSuccess(deletion);
  } catch {
    // The write may have succeeded despite a lost response. Verify by reads only.
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const rows = await listPlaylists(api, cookie, userId, records, "user_playlist:rollback_verify");
      if (!temporaryMatch(rows, names, userId)) {
        records.push({ endpoint: "playlist_cleanup", httpStatus: null, businessCode: null,
          fields: { located: { present: true }, confirmed: { present: true } } });
        return true;
      }
    } catch {
      // A later read may still establish whether the write was applied.
    }
    if (attempt < 3) await pause(1_500);
  }
  records.push({ endpoint: "playlist_cleanup", httpStatus: null, businessCode: null,
    fields: { located: { present: true }, confirmed: { present: false } } });
  return false;
}

export async function runPlaylistManagementProbe(api, cookie, userId, records, options = {}) {
  if (!numericIdPattern.test(userId) || !cookie || requiredMethods.some((name) => typeof api[name] !== "function")) {
    throw new Error("The authenticated probe preconditions are unavailable.");
  }
  const pause = options.pause ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const token = (options.createToken ?? randomUUID)().replaceAll("-", "").slice(0, 16);
  const originalName = `ECHOFORM-T022-${token}`;
  const editedName = `ECHOFORM-T022E-${token}`;
  const description = "ECHOFORM T022 temporary verification";
  const tag = "\u6d41\u884c";
  const names = new Set([originalName, editedName]);
  let attemptedCreation = false;
  let failure = null;
  try {
    const existing = await listPlaylists(api, cookie, userId, records, "user_playlist:preflight");
    if (temporaryMatch(existing, names, userId)) throw new Error("Temporary playlist name already exists.");
    try {
      await readExistingDetail(api, cookie, userId, existing, records);
    } catch {
      records.push({ endpoint: "playlist_detail:existing_read", httpStatus: null, businessCode: null,
        fields: { confirmed: { present: false } } });
    }
    attemptedCreation = true;
    const created = await callResponse(records, "playlist_create:private", api.playlist_create, {
      name: originalName, privacy: 10, type: "NORMAL", cookie, timestamp: Date.now(),
    }, [{ label: "playlist", path: ["playlist"] }]);
    requireSuccess(created);
    const id = await locateTemporary(api, cookie, userId, names, records, pause);
    if (!id) throw new Error("Created playlist could not be identified for cleanup.");
    await confirmTemporaryDetail(api, cookie, id, userId, { name: originalName, privacy: 10 },
      records, pause, "playlist_detail:private");

    try {
      const anonymous = await callResponse(records, "playlist_detail:private_anonymous", api.playlist_detail, {
        id, timestamp: Date.now(),
      }, [{ label: "playlist", path: ["playlist"] }]);
      records.push({ endpoint: "playlist_detail:private_anonymous_access", httpStatus: null, businessCode: null,
        fields: { detailReturned: { present: anonymous.status === 200 && Boolean(record(body(anonymous).playlist)) } } });
    } catch {
      // A denied anonymous read is an expected upstream permission outcome.
    }

    const renamed = await callResponse(records, "playlist_name_update", api.playlist_name_update, {
      id, name: editedName, cookie, timestamp: Date.now(),
    });
    requireSuccess(renamed);
    await confirmTemporaryDetail(api, cookie, id, userId, { name: editedName, privacy: 10 },
      records, pause, "playlist_detail:name_verify");

    const described = await callResponse(records, "playlist_desc_update", api.playlist_desc_update, {
      id, desc: description, cookie, timestamp: Date.now(),
    });
    requireSuccess(described);
    await confirmTemporaryDetail(api, cookie, id, userId,
      { name: editedName, privacy: 10, description }, records, pause, "playlist_detail:description_verify");

    const tagged = await callResponse(records, "playlist_tags_update", api.playlist_tags_update, {
      id, tags: tag, cookie, timestamp: Date.now(),
    });
    requireSuccess(tagged);
    await confirmTemporaryDetail(api, cookie, id, userId,
      { name: editedName, privacy: 10, description, tag }, records, pause, "playlist_detail:tags_verify");

    const published = await callResponse(records, "playlist_privacy:publish", api.playlist_privacy, {
      id, cookie, timestamp: Date.now(),
    });
    requireSuccess(published);
    await confirmTemporaryDetail(api, cookie, id, userId,
      { name: editedName, privacy: 0, description, tag }, records, pause, "playlist_detail:public_verify");
  } catch (error) {
    failure = error;
  }
  const cleaned = await cleanupTemporary(api, cookie, userId, names, records, pause, attemptedCreation);
  if (!cleaned) throw new Error("MUTATION_ROLLBACK_UNCONFIRMED");
  if (failure) throw failure;
}

function parseArguments(args) {
  const required = ["--live", "--writes", "--confirm-external-writes", "--write-scope", "playlist-management"];
  if (args.length !== required.length || args.some((value, index) => value !== required[index])) {
    throw new Error("Explicit T022 probe flags are required.");
  }
}

async function main() {
  try { parseArguments(process.argv.slice(2)); } catch {
    process.stderr.write("Probe arguments are invalid. No network request was made.\n");
    return 2;
  }
  let session = null;
  let qrPage = null;
  let failed = false;
  try {
    session = await startLiveProbeSession();
    qrPage = await createTransientQrPage(0);
    qrPage.setImage(session.qrImageDataUrl);
    process.stderr.write(`[probe] Open the temporary QR page with the dedicated test account: ${qrPage.url}\n`);
    await pollLiveProbeSession(session, 300_000, (stage) => process.stderr.write(`[probe] ${stage}\n`));
    await completeLiveProbeSession(session, { preflight: false, writes: false },
      (stage) => process.stderr.write(`[probe] ${stage}\n`));
    await runPlaylistManagementProbe(session.api, session.upstreamCookie, session.userId, session.records);
  } catch (error) {
    failed = true;
    process.stderr.write(`[probe] ${error instanceof Error && error.message === "MUTATION_ROLLBACK_UNCONFIRMED"
      ? "MUTATION_ROLLBACK_UNCONFIRMED" : "Probe stopped; see sanitized endpoint report."}\n`);
  } finally {
    if (session) await closeLiveProbeSession(session);
    if (qrPage) await qrPage.close();
  }
  process.stdout.write(`${JSON.stringify(session?.records ?? [], null, 2)}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
