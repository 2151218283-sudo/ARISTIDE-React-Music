import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SessionAuthService,
  type SessionAuthUpstream,
} from "../../src/lib/session/authService";
import {
  InMemorySessionStore,
  SESSION_IDLE_TTL_MS,
} from "../../src/lib/session/sessionStore";
import type { PlaybackSource } from "../../src/lib/music/models";

const user = {
  id: "9001",
  nickname: "测试用户",
  avatarUrl: null,
  signature: null,
};

const relaySource: PlaybackSource = {
  url: "http://music.126.net/synthetic-stream",
  expiresAt: 2_000,
  quality: "standard",
  codec: "mp3",
  bitrate: 128_000,
  sampleRate: 44_100,
  sizeBytes: 1,
  corsMode: "unavailable",
};

function createOpaqueServerValue(): string {
  return randomBytes(32).toString("base64url");
}

function createStore(now: () => number): InMemorySessionStore {
  return new InMemorySessionStore({ now });
}

function createUpstream(
  overrides: Partial<SessionAuthUpstream> = {},
): SessionAuthUpstream {
  return {
    startQrLogin: async () => ({
      key: createOpaqueServerValue(),
      qrImageDataUrl: "data:image/png;base64,visual-stage-placeholder",
    }),
    pollQrLogin: async () => ({ status: "waiting" }),
    getSessionUser: async () => user,
    logout: async () => undefined,
    ...overrides,
  };
}

describe("InMemorySessionStore", () => {
  it("creates opaque 256-bit real-mode session IDs", () => {
    let now = 100;
    const store = createStore(() => now);
    const first = store.create();
    now += 1;
    const second = store.create();

    expect(first.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ mode: "real", user: null, qr: null });
  });

  it("removes idle sessions instead of restoring them after their deadline", () => {
    let now = 1_000;
    const store = createStore(() => now);
    const session = store.create();

    now += SESSION_IDLE_TTL_MS;

    expect(store.get(session.id)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("supersedes QR challenges and never exposes their key through public state", () => {
    const store = createStore(() => 1_000);
    const session = store.create();
    const firstKey = createOpaqueServerValue();
    const secondKey = createOpaqueServerValue();
    const first = store.beginQrChallenge(session.id, firstKey);
    const second = store.beginQrChallenge(session.id, secondKey);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(store.getQrChallenge(session.id, first?.challengeId ?? "")).toBeNull();
    expect(store.getQrChallenge(session.id, second?.challengeId ?? "")).toMatchObject({
      status: "waiting",
    });
    expect(JSON.stringify(store.getPublicState(session.id))).not.toContain(firstKey);
    expect(JSON.stringify(store.getPublicState(session.id))).not.toContain(secondKey);
  });

  it("isolates the public user in demo mode and clears daily cache on context changes", () => {
    const store = createStore(() => 1_000);
    const session = store.create();
    const key = createOpaqueServerValue();
    const challenge = store.beginQrChallenge(session.id, key);
    if (!challenge) {
      throw new Error("Expected a server QR challenge.");
    }
    store.authorizeQrChallenge(session.id, challenge.challengeId, createOpaqueServerValue());
    store.setAuthenticatedUser(session.id, user);
    store.setDailyRecommendations(session.id, "personal:9001:2026-07-30", {
      date: "2026-07-30",
      source: "personal",
      tracks: [],
    });

    expect(store.getDailyRecommendations(
      session.id,
      "personal:9001:2026-07-30",
    )).not.toBeNull();
    expect(store.setMode(session.id, "demo")).toBe(true);
    expect(store.getPublicState(session.id)).toEqual({ mode: "demo", user: null });
    expect(store.getDailyRecommendations(
      session.id,
      "personal:9001:2026-07-30",
    )).toBeNull();
    expect(store.setMode(session.id, "real")).toBe(true);
    expect(store.getPublicState(session.id)).toEqual({ mode: "real", user });
  });

  it("isolates, expires, and clears relay sources with their session context", () => {
    let now = 1_000;
    const store = createStore(() => now);
    const first = store.create();
    const second = store.create();

    expect(store.setAudioRelaySource(first.id, "101", relaySource)).toBe(true);
    expect(store.getAudioRelaySource(second.id, "101")).toBeNull();
    expect(store.setMode(first.id, "demo")).toBe(true);
    expect(store.getAudioRelaySource(first.id, "101")).toBeNull();

    expect(store.setAudioRelaySource(first.id, "101", relaySource)).toBe(true);
    now = relaySource.expiresAt;
    expect(store.getAudioRelaySource(first.id, "101")).toBeNull();
    expect(store.setAudioRelaySource(first.id, "101", relaySource)).toBe(false);
  });
});

describe("SessionAuthService", () => {
  it("keeps the authorization credential server-only and clears the QR challenge", async () => {
    const store = createStore(() => 1_000);
    const serverCredential = createOpaqueServerValue();
    const service = new SessionAuthService(store, createUpstream({
      pollQrLogin: async () => ({
        status: "authorized",
        upstreamCookie: serverCredential,
      }),
    }));
    const session = service.resolveSession(null).session;
    const challenge = await service.startQrLogin(session.id);
    const result = await service.pollQrLogin(session.id, challenge.challengeId);

    expect(result).toEqual({ status: "authorized", user });
    expect(store.getQrChallenge(session.id, challenge.challengeId)).toBeNull();
    expect(service.getSessionState(session.id)).toEqual({ mode: "real", user });
    expect(JSON.stringify(service.getSessionState(session.id))).not.toContain(serverCredential);
  });

  it("rejects an authorized QR result with no valid normalized user", async () => {
    const store = createStore(() => 1_000);
    const service = new SessionAuthService(store, createUpstream({
      pollQrLogin: async () => ({
        status: "authorized",
        upstreamCookie: createOpaqueServerValue(),
      }),
      getSessionUser: async () => null,
    }));
    const session = service.resolveSession(null).session;
    const challenge = await service.startQrLogin(session.id);

    await expect(service.pollQrLogin(session.id, challenge.challengeId)).rejects
      .toMatchObject({ code: "SESSION_EXPIRED" });
    expect(service.getSessionState(session.id)).toEqual({ mode: "real", user: null });
  });

  it("always destroys the local session after an upstream logout error", async () => {
    const store = createStore(() => 1_000);
    const service = new SessionAuthService(store, createUpstream({
      logout: async () => {
        throw new Error("offline");
      },
    }));
    const session = service.resolveSession(null).session;
    const challenge = await service.startQrLogin(session.id);
    const credential = createOpaqueServerValue();
    store.authorizeQrChallenge(session.id, challenge.challengeId, credential);
    store.setAuthenticatedUser(session.id, user);

    await service.logout(session.id);

    expect(store.get(session.id)).toBeNull();
  });
});
