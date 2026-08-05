import { randomBytes } from "node:crypto";

import type {
  DailyRecommendations,
  DataMode,
  PlaybackSource,
  UserProfile,
} from "@/lib/music/models";

export const SESSION_COOKIE_NAME = "echoform.sid";
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1_000;
export const QR_CHALLENGE_TTL_MS = 5 * 60 * 1_000;

export type QrChallengeStatus = "waiting" | "scanned";

export interface ServerQrChallenge {
  challengeId: string;
  key: string;
  expiresAt: number;
  status: QrChallengeStatus;
}

export interface ServerSession {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  mode: DataMode;
  user: UserProfile | null;
  upstreamCookie: string | null;
  qr: ServerQrChallenge | null;
  dailyRecommendations: Map<string, DailyRecommendations>;
  audioRelaySources: Map<string, PlaybackSource>;
}

export interface PublicSessionState {
  mode: DataMode;
  user: UserProfile | null;
}

export interface SessionStoreOptions {
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  idleTtlMs?: number;
  challengeTtlMs?: number;
}

export interface ResolvedSession {
  created: boolean;
  session: ServerSession;
}

function createOpaqueId(random: (size: number) => Buffer): string {
  return random(32).toString("base64url");
}

export class InMemorySessionStore {
  private readonly sessions = new Map<string, ServerSession>();
  private readonly publicDailyRecommendations = new Map<string, DailyRecommendations>();
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;
  private readonly idleTtlMs: number;
  private readonly challengeTtlMs: number;

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.randomBytes ?? randomBytes;
    this.idleTtlMs = options.idleTtlMs ?? SESSION_IDLE_TTL_MS;
    this.challengeTtlMs = options.challengeTtlMs ?? QR_CHALLENGE_TTL_MS;
  }

  create(): ServerSession {
    const now = this.now();
    const session: ServerSession = {
      id: this.createUniqueId(),
      createdAt: now,
      lastSeenAt: now,
      mode: "real",
      user: null,
      upstreamCookie: null,
      qr: null,
      dailyRecommendations: new Map(),
      audioRelaySources: new Map(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  resolve(sessionId: string | null | undefined): ResolvedSession {
    const existing = sessionId ? this.get(sessionId) : null;
    if (existing) {
      return { created: false, session: existing };
    }
    return { created: true, session: this.create() };
  }

  get(sessionId: string): ServerSession | null {
    this.pruneExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    session.lastSeenAt = this.now();
    return session;
  }

  getPublicState(sessionId: string): PublicSessionState | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }
    return {
      mode: session.mode,
      user: session.mode === "demo" ? null : session.user,
    };
  }

  beginQrChallenge(sessionId: string, key: string): ServerQrChallenge | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }
    const challenge: ServerQrChallenge = {
      challengeId: this.createUniqueId(),
      key,
      expiresAt: this.now() + this.challengeTtlMs,
      status: "waiting",
    };
    session.qr = challenge;
    return challenge;
  }

  getQrChallenge(
    sessionId: string,
    challengeId: string,
  ): ServerQrChallenge | null {
    const session = this.get(sessionId);
    const challenge = session?.qr;
    if (!challenge || challenge.challengeId !== challengeId) {
      return null;
    }
    if (challenge.expiresAt <= this.now()) {
      session.qr = null;
      return null;
    }
    return challenge;
  }

  updateQrStatus(
    sessionId: string,
    challengeId: string,
    status: QrChallengeStatus,
  ): ServerQrChallenge | null {
    const challenge = this.getQrChallenge(sessionId, challengeId);
    if (!challenge) {
      return null;
    }
    challenge.status = status;
    return challenge;
  }

  clearQrChallenge(sessionId: string, challengeId?: string): boolean {
    const session = this.get(sessionId);
    if (!session?.qr) {
      return false;
    }
    if (challengeId && session.qr.challengeId !== challengeId) {
      return false;
    }
    session.qr = null;
    return true;
  }

  authorizeQrChallenge(
    sessionId: string,
    challengeId: string,
    upstreamCookie: string,
  ): boolean {
    const challenge = this.getQrChallenge(sessionId, challengeId);
    if (!challenge) {
      return false;
    }
    const session = this.get(sessionId);
    if (!session) {
      return false;
    }
    session.upstreamCookie = upstreamCookie;
    session.qr = null;
    session.dailyRecommendations.clear();
    session.audioRelaySources.clear();
    return true;
  }

  setAuthenticatedUser(sessionId: string, user: UserProfile): boolean {
    const session = this.get(sessionId);
    if (!session || !session.upstreamCookie) {
      return false;
    }
    session.user = user;
    session.dailyRecommendations.clear();
    session.audioRelaySources.clear();
    return true;
  }

  clearAuthentication(sessionId: string): boolean {
    const session = this.get(sessionId);
    if (!session) {
      return false;
    }
    session.user = null;
    session.upstreamCookie = null;
    session.dailyRecommendations.clear();
    session.audioRelaySources.clear();
    return true;
  }

  setMode(sessionId: string, mode: DataMode): boolean {
    const session = this.get(sessionId);
    if (!session) {
      return false;
    }
    if (session.mode !== mode) {
      session.mode = mode;
      session.dailyRecommendations.clear();
      session.audioRelaySources.clear();
    }
    return true;
  }

  getDailyRecommendations(
    sessionId: string,
    cacheKey: string,
  ): DailyRecommendations | null {
    const session = this.get(sessionId);
    return session?.dailyRecommendations.get(cacheKey) ?? null;
  }

  setDailyRecommendations(
    sessionId: string,
    cacheKey: string,
    recommendations: DailyRecommendations,
  ): boolean {
    const session = this.get(sessionId);
    if (!session) {
      return false;
    }
    session.dailyRecommendations.set(cacheKey, recommendations);
    return true;
  }

  getPublicDailyRecommendations(cacheKey: string): DailyRecommendations | null {
    return this.publicDailyRecommendations.get(cacheKey) ?? null;
  }

  setPublicDailyRecommendations(
    cacheKey: string,
    recommendations: DailyRecommendations,
  ): void {
    this.publicDailyRecommendations.set(cacheKey, recommendations);
  }

  clearDailyRecommendations(sessionId: string): boolean {
    const session = this.get(sessionId);
    if (!session) {
      return false;
    }
    session.dailyRecommendations.clear();
    return true;
  }

  setAudioRelaySource(
    sessionId: string,
    trackId: string,
    source: PlaybackSource,
  ): boolean {
    const session = this.get(sessionId);
    if (!session || source.expiresAt <= this.now()) {
      return false;
    }
    session.audioRelaySources.set(trackId, source);
    return true;
  }

  getAudioRelaySource(sessionId: string, trackId: string): PlaybackSource | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }
    const source = session.audioRelaySources.get(trackId) ?? null;
    if (!source) {
      return null;
    }
    if (source.expiresAt <= this.now()) {
      session.audioRelaySources.delete(trackId);
      return null;
    }
    return source;
  }

  clearAudioRelaySources(sessionId: string): boolean {
    const session = this.get(sessionId);
    if (!session) {
      return false;
    }
    session.audioRelaySources.clear();
    return true;
  }

  getUpstreamCookie(sessionId: string): string | null {
    return this.get(sessionId)?.upstreamCookie ?? null;
  }

  destroy(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  size(): number {
    this.pruneExpired();
    return this.sessions.size;
  }

  private createUniqueId(): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const id = createOpaqueId(this.random);
      if (!this.sessions.has(id)) {
        return id;
      }
    }
    throw new Error("Unable to create a unique session identifier.");
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.lastSeenAt + this.idleTtlMs <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

interface SessionStoreGlobal {
  __echoformSessionStore?: InMemorySessionStore;
}

const sessionStoreGlobal = globalThis as typeof globalThis & SessionStoreGlobal;

// Route handlers can be evaluated from separate development bundles in one process.
export const sessionStore = sessionStoreGlobal.__echoformSessionStore
  ?? new InMemorySessionStore();

sessionStoreGlobal.__echoformSessionStore = sessionStore;

export function readSessionIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      return rawValue.join("=") || null;
    }
  }

  return null;
}
