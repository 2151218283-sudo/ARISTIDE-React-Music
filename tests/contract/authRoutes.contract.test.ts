import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createAuthRouteHandlers,
  type AuthRouteHandlers,
} from "../../src/lib/session/authBff";
import type {
  SessionAuthUpstream,
  UpstreamQrPollResult,
} from "../../src/lib/session/authService";
import { InMemorySessionStore } from "../../src/lib/session/sessionStore";

const user = {
  id: "9001",
  nickname: "测试用户",
  avatarUrl: null,
  signature: null,
};

function createOpaqueServerValue(): string {
  return randomBytes(32).toString("base64url");
}

function createNonScannableImageDataUrl(): string {
  return `data:image/png;base64,${Buffer.from("visual-stage-placeholder").toString("base64")}`;
}

function createUpstream(
  overrides: Partial<SessionAuthUpstream> = {},
): SessionAuthUpstream {
  return {
    startQrLogin: async () => ({
      key: createOpaqueServerValue(),
      qrImageDataUrl: createNonScannableImageDataUrl(),
    }),
    pollQrLogin: async () => ({ status: "waiting" }),
    getSessionUser: async () => user,
    logout: async () => undefined,
    ...overrides,
  };
}

function createHandlers(
  upstream: SessionAuthUpstream,
  options: { timeoutMs?: number } = {},
): AuthRouteHandlers {
  let requestNumber = 0;
  return createAuthRouteHandlers({
    store: new InMemorySessionStore(),
    createUpstream: () => upstream,
    createRequestId: () => `auth-request-${++requestNumber}`,
    now: () => 1_700_000_000_000,
    timeoutMs: options.timeoutMs,
  });
}

function getSessionCookie(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  const cookie = setCookie?.split(";")[0];
  if (!cookie) {
    throw new Error("Expected an ECHOFORM session cookie.");
  }
  return cookie;
}

async function getJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function createSession(
  handlers: AuthRouteHandlers,
): Promise<string> {
  const response = await handlers.session(
    new Request("http://localhost/api/auth/session"),
  );
  return getSessionCookie(response);
}

async function startChallenge(
  handlers: AuthRouteHandlers,
  cookie: string,
): Promise<string> {
  const response = await handlers.startQr(new Request("http://localhost/api/auth/qr", {
    method: "POST",
    headers: { cookie },
  }));
  const body = await getJson<{
    ok: boolean;
    data: { challengeId: string };
  }>(response);
  if (!body.ok) {
    throw new Error("Expected QR challenge to start.");
  }
  return body.data.challengeId;
}

describe("auth BFF routes", () => {
  it("creates a guest real-mode session through an HttpOnly, no-store response", async () => {
    const handlers = createHandlers(createUpstream());
    const response = await handlers.session(
      new Request("http://localhost/api/auth/session"),
    );
    const body = await getJson<{
      ok: boolean;
      data: { mode: string; user: null };
      meta: { requestId: string; mode: string };
    }>(response);
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toMatch(
      /^echoform\.sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    expect(body).toMatchObject({
      ok: true,
      data: { mode: "real", user: null },
      meta: { requestId: "auth-request-1", mode: "real" },
    });
    expect(text).not.toContain("echoform.sid");
  });

  it("maps offline QR 801, 802, 803, and 800 states without exposing server values", async () => {
    let status: UpstreamQrPollResult = { status: "waiting" };
    const qrKey = createOpaqueServerValue();
    const credential = createOpaqueServerValue();
    const upstream = createUpstream({
      startQrLogin: async () => ({
        key: qrKey,
        qrImageDataUrl: createNonScannableImageDataUrl(),
      }),
      pollQrLogin: async () => status,
    });
    const handlers = createHandlers(upstream);
    const cookie = await createSession(handlers);
    const challengeId = await startChallenge(handlers, cookie);

    const waiting = await handlers.qrStatus(new Request(
      `http://localhost/api/auth/qr/status?challengeId=${challengeId}`,
      { headers: { cookie } },
    ));
    status = { status: "scanned" };
    const scanned = await handlers.qrStatus(new Request(
      `http://localhost/api/auth/qr/status?challengeId=${challengeId}`,
      { headers: { cookie } },
    ));
    status = { status: "authorized", upstreamCookie: credential };
    const authorized = await handlers.qrStatus(new Request(
      `http://localhost/api/auth/qr/status?challengeId=${challengeId}`,
      { headers: { cookie } },
    ));
    const session = await handlers.session(new Request(
      "http://localhost/api/auth/session",
      { headers: { cookie } },
    ));
    const secondChallenge = await startChallenge(handlers, cookie);
    status = { status: "expired" };
    const expired = await handlers.qrStatus(new Request(
      `http://localhost/api/auth/qr/status?challengeId=${secondChallenge}`,
      { headers: { cookie } },
    ));

    expect(await getJson<{ data: { status: string } }>(waiting)).toMatchObject({
      data: { status: "waiting" },
    });
    expect(await getJson<{ data: { status: string } }>(scanned)).toMatchObject({
      data: { status: "scanned" },
    });
    expect(await getJson<{ data: { status: string; user: { id: string } } }>(authorized))
      .toMatchObject({ data: { status: "authorized", user: { id: "9001" } } });
    expect(await getJson<{ data: { user: { id: string } } }>(session))
      .toMatchObject({ data: { user: { id: "9001" } } });
    expect(await getJson<{ data: { status: string } }>(expired)).toMatchObject({
      data: { status: "expired" },
    });
    const publicText = JSON.stringify(await getJson(await handlers.session(new Request(
      "http://localhost/api/auth/session",
      { headers: { cookie } },
    ))));
    expect(publicText).not.toContain(qrKey);
    expect(publicText).not.toContain(credential);
  });

  it("rejects missing, foreign, and superseded challenge IDs as QR_EXPIRED", async () => {
    const handlers = createHandlers(createUpstream());
    const firstCookie = await createSession(handlers);
    const secondCookie = await createSession(handlers);
    const firstChallenge = await startChallenge(handlers, firstCookie);
    const replacement = await startChallenge(handlers, firstCookie);
    const foreign = await handlers.qrStatus(new Request(
      `http://localhost/api/auth/qr/status?challengeId=${replacement}`,
      { headers: { cookie: secondCookie } },
    ));
    const superseded = await handlers.qrStatus(new Request(
      `http://localhost/api/auth/qr/status?challengeId=${firstChallenge}`,
      { headers: { cookie: firstCookie } },
    ));
    const missing = await handlers.qrStatus(new Request(
      "http://localhost/api/auth/qr/status",
      { headers: { cookie: firstCookie } },
    ));

    for (const response of [foreign, superseded, missing]) {
      const body = await getJson<{
        ok: boolean;
        error: { code: string; requestId: string };
      }>(response);
      expect(response.status).toBe(410);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toMatchObject({ ok: false, error: { code: "QR_EXPIRED" } });
    }
  });

  it("returns a sanitized timeout error and always clears the session on logout", async () => {
    const upstream = createUpstream({
      startQrLogin: async () => await new Promise<never>(() => undefined),
      logout: async () => {
        throw new Error(`raw-server-value=${createOpaqueServerValue()}`);
      },
    });
    const handlers = createHandlers(upstream, { timeoutMs: 1 });
    const cookie = await createSession(handlers);
    const start = await handlers.startQr(new Request("http://localhost/api/auth/qr", {
      method: "POST",
      headers: { cookie },
    }));
    const timeoutBody = await getJson<{
      ok: boolean;
      error: { code: string; retryable: boolean };
    }>(start);
    const logout = await handlers.logout(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    }));
    const restored = await handlers.session(new Request(
      "http://localhost/api/auth/session",
      { headers: { cookie } },
    ));

    expect(start.status).toBe(504);
    expect(timeoutBody).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_TIMEOUT", retryable: true },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await getJson<{ data: { user: null; mode: string } }>(restored))
      .toMatchObject({ data: { user: null, mode: "real" } });
  });
});
