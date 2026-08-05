import { describe, expect, it, vi } from "vitest";

import {
  audioRelayHeaders,
  isAllowedAudioRelayUrl,
  openRelayedAudio,
  parseAudioRange,
  type AudioRelayUpstreamResponse,
} from "../../src/lib/music/audioRelay.server";

function stream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
}

function upstream(
  status: number,
  headers: Record<string, string> = {},
): AudioRelayUpstreamResponse {
  return { status, headers: new Headers(headers), body: stream() };
}

describe("audio relay transport boundary", () => {
  it("allows only HTTP(S) Netease media hosts without embedded credentials", () => {
    expect(isAllowedAudioRelayUrl(new URL("http://music.126.net/synthetic"))).toBe(true);
    expect(isAllowedAudioRelayUrl(new URL("https://edge.music.163.com/synthetic"))).toBe(true);
    expect(isAllowedAudioRelayUrl(new URL("https://music.126.net.example.invalid/synthetic")))
      .toBe(false);
    expect(isAllowedAudioRelayUrl(new URL("https://user@music.126.net/synthetic"))).toBe(false);
  });

  it("forwards one well-formed Range and rejects malformed, multi, and reversed ranges", () => {
    expect(parseAudioRange(new Request("http://localhost/audio"))).toBeNull();
    expect(parseAudioRange(new Request("http://localhost/audio", {
      headers: { Range: "bytes=-500" },
    }))).toBe("bytes=-500");
    expect(parseAudioRange(new Request("http://localhost/audio", {
      headers: { Range: "bytes=0-0" },
    }))).toBe("bytes=0-0");

    for (const range of ["bytes=0-1,3-4", "items=0-1", "bytes=8-7", "bytes=-"]) {
      expect(() => parseAudioRange(new Request("http://localhost/audio", {
        headers: { Range: range },
      }))).toThrow("Invalid audio range.");
    }
  });

  it("follows only validated redirects and preserves the requested range", async () => {
    const open = vi.fn()
      .mockResolvedValueOnce(upstream(302, {
        location: "https://edge.music.126.net/synthetic-next",
      }))
      .mockResolvedValueOnce(upstream(206, {
        "content-type": "audio/mpeg",
        "content-range": "bytes 0-0/1",
      }));

    const result = await openRelayedAudio(
      "http://music.126.net/synthetic-start",
      "bytes=0-0",
      open,
    );

    expect(result.status).toBe(206);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenNthCalledWith(1, expect.any(URL), "bytes=0-0");
    expect(open).toHaveBeenNthCalledWith(2, expect.any(URL), "bytes=0-0");
  });

  it("does not open unapproved hosts and maps denied upstream media to safe errors", async () => {
    const open = vi.fn();

    await expect(openRelayedAudio(
      "https://example.invalid/synthetic",
      null,
      open,
    )).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(open).not.toHaveBeenCalled();

    await expect(openRelayedAudio(
      "https://music.163.com/synthetic",
      null,
      async () => upstream(403),
    )).rejects.toMatchObject({ code: "TRACK_UNAVAILABLE" });
  });

  it("copies only the permitted media headers and forces no-store", () => {
    const headers = audioRelayHeaders(new Headers({
      "content-type": "audio/mpeg",
      "content-length": "1",
      location: "https://music.126.net/not-forwarded",
      "set-cookie": "not-forwarded",
      "x-upstream-private": "not-forwarded",
    }));

    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("Content-Type")).toBe("audio/mpeg");
    expect(headers.get("Content-Length")).toBe("1");
    expect(headers.get("Location")).toBeNull();
    expect(headers.get("Set-Cookie")).toBeNull();
    expect(headers.get("X-Upstream-Private")).toBeNull();
  });
});
