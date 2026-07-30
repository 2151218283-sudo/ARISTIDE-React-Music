import { AppError } from "@/lib/music/errors";
import type {
  DataMode,
  QrLoginState,
  UserProfile,
} from "@/lib/music/models";

import {
  InMemorySessionStore,
  type PublicSessionState,
  type ServerQrChallenge,
} from "./sessionStore";

export interface UpstreamQrChallenge {
  key: string;
  qrImageDataUrl: string;
}

export type UpstreamQrPollResult =
  | { status: "expired" }
  | { status: "waiting" }
  | { status: "scanned" }
  | { status: "authorized"; upstreamCookie: string };

export interface SessionAuthUpstream {
  startQrLogin(): Promise<UpstreamQrChallenge>;
  pollQrLogin(key: string): Promise<UpstreamQrPollResult>;
  getSessionUser(upstreamCookie: string): Promise<UserProfile | null>;
  logout(upstreamCookie: string): Promise<void>;
}

export interface StartQrLoginResponse {
  challengeId: string;
  status: "waiting";
  qrImageDataUrl: string;
  expiresAt: number;
}

export interface SessionStateResponse extends PublicSessionState {
  mode: DataMode;
}

function qrExpiredError(): AppError {
  return new AppError("QR_EXPIRED", "二维码已过期，请刷新后重试。", {
    retryable: false,
  });
}

export class SessionAuthService {
  constructor(
    private readonly store: InMemorySessionStore,
    private readonly upstream: SessionAuthUpstream,
  ) {}

  resolveSession(sessionId: string | null | undefined) {
    return this.store.resolve(sessionId);
  }

  getSessionState(sessionId: string): SessionStateResponse {
    const state = this.store.getPublicState(sessionId);
    if (!state) {
      throw new AppError("SESSION_EXPIRED", "登录状态已失效，请重新登录。", {
        retryable: false,
      });
    }
    return state;
  }

  async startQrLogin(sessionId: string): Promise<StartQrLoginResponse> {
    this.store.clearQrChallenge(sessionId);
    const upstreamChallenge = await this.upstream.startQrLogin();
    const challenge = this.store.beginQrChallenge(sessionId, upstreamChallenge.key);
    if (!challenge) {
      throw new AppError("SESSION_EXPIRED", "登录状态已失效，请重新开始。", {
        retryable: false,
      });
    }
    return this.toStartResponse(challenge, upstreamChallenge.qrImageDataUrl);
  }

  async pollQrLogin(sessionId: string, challengeId: string): Promise<QrLoginState> {
    const challenge = this.store.getQrChallenge(sessionId, challengeId);
    if (!challenge) {
      throw qrExpiredError();
    }

    const result = await this.upstream.pollQrLogin(challenge.key);
    if (result.status === "expired") {
      this.store.clearQrChallenge(sessionId, challengeId);
      return { status: "expired" };
    }
    if (result.status === "waiting" || result.status === "scanned") {
      const updated = this.store.updateQrStatus(sessionId, challengeId, result.status);
      if (!updated) {
        throw qrExpiredError();
      }
      return { status: updated.status, expiresAt: updated.expiresAt };
    }

    if (!this.store.authorizeQrChallenge(
      sessionId,
      challengeId,
      result.upstreamCookie,
    )) {
      throw qrExpiredError();
    }

    try {
      const user = await this.upstream.getSessionUser(result.upstreamCookie);
      if (!user || !this.store.setAuthenticatedUser(sessionId, user)) {
        this.store.clearAuthentication(sessionId);
        throw new AppError("SESSION_EXPIRED", "登录状态验证失败，请重新扫码。", {
          retryable: false,
        });
      }
      return { status: "authorized", user };
    } catch (error) {
      this.store.clearAuthentication(sessionId);
      throw error;
    }
  }

  async logout(sessionId: string | null | undefined): Promise<void> {
    if (!sessionId) {
      return;
    }
    const upstreamCookie = this.store.getUpstreamCookie(sessionId);
    try {
      if (upstreamCookie) {
        await this.upstream.logout(upstreamCookie);
      }
    } catch {
      // Local session destruction is required even when the upstream is unavailable.
    } finally {
      this.store.destroy(sessionId);
    }
  }

  private toStartResponse(
    challenge: ServerQrChallenge,
    qrImageDataUrl: string,
  ): StartQrLoginResponse {
    return {
      challengeId: challenge.challengeId,
      status: "waiting",
      qrImageDataUrl,
      expiresAt: challenge.expiresAt,
    };
  }
}
