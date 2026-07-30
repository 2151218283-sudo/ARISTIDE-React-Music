import { describe, expect, it } from "vitest";

import {
  findActiveLyricLine,
  findActiveLyricWord,
  parseLyrics,
} from "../../src/lib/player";

describe("player lyric parsing", () => {
  it("parses, sorts, offsets, and merges translated LRC lines", () => {
    const lyrics = parseLyrics({
      lrc: "[offset:100]\n[00:02.00]Second\n[00:01.5][00:03.000]First",
      tlyric: "[00:01.60]第一\n[00:02.10]第二",
      romalrc: "[00:01.60]Dai ichi",
    });

    expect(lyrics.kind).toBe("synced");
    expect(lyrics.lines.map((line) => line.startMs)).toEqual([1_600, 2_100, 3_100]);
    expect(lyrics.lines[0]).toMatchObject({
      text: "First",
      translation: "第一",
      romanization: "Dai ichi",
      durationMs: 500,
    });
  });

  it("adds YRC word timing and degrades to line timing when YRC is absent", () => {
    const withWords = parseLyrics({
      lrc: "[00:01.000]Hello world",
      yrc: "[1000,1000](1000,400,0)Hello (1400,600,0)world",
    });
    expect(withWords.lines[0].words).toEqual([
      { startMs: 1_000, durationMs: 400, text: "Hello " },
      { startMs: 1_400, durationMs: 600, text: "world" },
    ]);
    expect(findActiveLyricWord(withWords.lines[0].words, 1_500)).toBe(1);

    const withoutWords = parseLyrics({ lrc: "[00:01.000]Hello world" });
    expect(withoutWords).toMatchObject({ kind: "synced", lines: [{ words: null }] });
  });

  it("supports YRC-only input and deterministic plain/instrumental/unavailable fallbacks", () => {
    expect(parseLyrics({
      yrc: "[2000,900](0,400,0)Soft (400,500,0)light",
    })).toMatchObject({ kind: "synced", lines: [{ startMs: 2_000, text: "Soft light" }] });

    expect(parseLyrics({ lrc: "A plain line\nAnother line" })).toMatchObject({
      kind: "plain",
      lines: [{ text: "A plain line" }, { text: "Another line" }],
    });
    expect(parseLyrics({ instrumental: true, lrc: "ignored" })).toEqual({
      kind: "instrumental",
      lines: [],
    });
    expect(parseLyrics({ lrc: "[ar:Metadata only]" })).toEqual({
      kind: "unavailable",
      lines: [],
    });
  });

  it("uses binary lookup before, within, and after lyric bounds", () => {
    const lines = parseLyrics({
      lrc: "[00:01.000]One\n[00:05.000]Five\n[00:10.000]Ten",
    }).lines;

    expect(findActiveLyricLine(lines, 999)).toBeNull();
    expect(findActiveLyricLine(lines, 1_000)).toBe(0);
    expect(findActiveLyricLine(lines, 7_500)).toBe(1);
    expect(findActiveLyricLine(lines, 99_000)).toBe(2);
    expect(findActiveLyricWord(null, 1_000)).toBeNull();
  });
});
