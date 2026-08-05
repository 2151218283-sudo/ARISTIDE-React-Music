import { describe, expect, it, vi } from "vitest";

import { createAudioRelayRouteHandlers } from "../../src/lib/music/audioRelayRouteHandlers.server";
import type { PublicReadRouteHandlers } from "../../src/lib/music/bff";
import type { PlaybackSource } from "../../src/lib/music/models";
import { InMemorySessionStore } from "../../src/lib/session/sessionStore";

const syntheticSource: PlaybackSource = {
  url: "http://music.126.net/synthetic-stream",
  expiresAt: 1_700_000_060_000,
  quality: "standard",
  codec: "mp3",
  bitrate: 128_000,
  sampleRate: 44_100,
  sizeBytes: 1,
  corsMode: "unavailable",
};

function stream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
}

function sourceHandler(source = syntheticSource): Pick<PublicReadRouteHandlers, "source"> {
  return {
    source: async () => Response.json({
      ok: true,
      data: source,
      meta: {
        requestId: "upstream-request",
        mode: "real",
        fetchedAt: "2023-11-14T22:13:20.000Z",
      },
    }, {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": "upstream-request",
      },
    }),
  };
}

function getSessionCookie(response: Response): string {
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Expected a session cookie.");
  }
  return cookie;
}

describe("audio relay BFF routes", () => {
  it("replaces the provider source with a session-bound local path without leakage", async () => {
    const store = new InMemorySessionStore({ now: () => 1_700_000_000_000 });
    const handlers = createAudioRelayRouteHandlers({
      publicReadRouteHandlers: sourceHandler(),
      store,
      createRequestId: () => "relay-request",
    });

    const response = await handlers.source(
      new Request("http://localhost/api/tracks/101/source"),
      "101",
    );
    const cookie = getSessionCookie(response);
    const text = await response.text();
    const body = JSON.parse(text) as { data: PlaybackSource };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.data.url).toBe("/api/tracks/101/audio");
    expect(text).not.toContain(syntheticSource.url);
    expect(text).not.toContain("music.126.net");
    expect(store.getAudioRelaySource(cookie.split("=")[1], "101"))
      .toMatchObject({ expiresAt: syntheticSource.expiresAt });
  });

  it("streams only to the publishing session and forwards a valid Range", async () => {
    const store = new InMemorySessionStore({ now: () => 1_700_000_000_000 });
    const openAudioUpstream = vi.fn(async () => ({
      status: 206,
      headers: new Headers({
        "content-type": "audio/mpeg",
        "content-range": "bytes 0-0/1",
        location: "https://music.126.net/not-forwarded",
        "set-cookie": "not-forwarded",
      }),
      body: stream(),
    }));
    const handlers = createAudioRelayRouteHandlers({
      publicReadRouteHandlers: sourceHandler(),
      store,
      createRequestId: () => "relay-request",
      openAudioUpstream,
    });
    const sourceResponse = await handlers.source(
      new Request("http://localhost/api/tracks/101/source"),
      "101",
    );
    const cookie = getSessionCookie(sourceResponse);
    const response = await handlers.audio(new Request(
      "http://localhost/api/tracks/101/audio",
      { headers: { cookie, Range: "bytes=0-0" } },
    ), "101");

    expect(response.status).toBe(206);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-0/1");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(openAudioUpstream).toHaveBeenCalledWith(expect.any(URL), "bytes=0-0");

    const foreignSession = store.create();
    const foreign = await handlers.audio(new Request(
      "http://localhost/api/tracks/101/audio",
      { headers: { cookie: `echoform.sid=${foreignSession.id}` } },
    ), "101");
    expect(foreign.status).toBe(409);
    expect(await foreign.text()).not.toContain(syntheticSource.url);
    expect(openAudioUpstream).toHaveBeenCalledTimes(1);
  });

  it("rejects expired registrations and invalid ranges before opening an upstream stream", async () => {
    let now = 1_700_000_000_000;
    const store = new InMemorySessionStore({ now: () => now });
    const openAudioUpstream = vi.fn();
    const handlers = createAudioRelayRouteHandlers({
      publicReadRouteHandlers: sourceHandler({
        ...syntheticSource,
        expiresAt: now + 1,
      }),
      store,
      createRequestId: () => "relay-request",
      openAudioUpstream,
    });
    const sourceResponse = await handlers.source(
      new Request("http://localhost/api/tracks/101/source"),
      "101",
    );
    const cookie = getSessionCookie(sourceResponse);
    now += 1;

    const expired = await handlers.audio(new Request(
      "http://localhost/api/tracks/101/audio",
      { headers: { cookie } },
    ), "101");
    const invalidRange = await handlers.audio(new Request(
      "http://localhost/api/tracks/101/audio",
      { headers: { cookie, Range: "bytes=0-1,3-4" } },
    ), "101");

    expect(expired.status).toBe(409);
    expect(invalidRange.status).toBe(400);
    expect(expired.headers.get("Cache-Control")).toBe("no-store");
    expect(invalidRange.headers.get("Cache-Control")).toBe("no-store");
    expect(openAudioUpstream).not.toHaveBeenCalled();
  });
});
