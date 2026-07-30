import { afterEach, describe, expect, it, vi } from "vitest";

import type { Track } from "../../src/lib/music/models";
import { resolvePlaybackSource } from "../../src/features/player/sourceClient";

function track(id: string): Track {
  return {
    id,
    name: `Track ${id}`,
    artists: [{ id: `artist-${id}`, name: "Artist", avatarUrl: null }],
    album: { id: `album-${id}`, name: "Album", artworkUrl: null },
    durationMs: 120_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: "standard" },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playback source client", () => {
  it("forwards controller cancellation to the same-origin source request", async () => {
    let receivedSignal: AbortSignal | undefined;
    const abortError = new Error("request aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        receivedSignal = init?.signal ?? undefined;
        receivedSignal?.addEventListener("abort", () => reject(abortError));
      },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const cancellation = new AbortController();

    const request = resolvePlaybackSource(track("101"), {
      revision: 1,
      cancelled: () => cancellation.signal.aborted,
      signal: cancellation.signal,
    });
    cancellation.abort();

    await expect(request).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tracks/101/source",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        signal: cancellation.signal,
      }),
    );
    expect(receivedSignal).toBe(cancellation.signal);
  });
});
