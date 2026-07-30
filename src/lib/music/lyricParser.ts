import type {
  LyricDocument,
  LyricLine,
  LyricWord,
} from "./models";

export interface LyricParseInput {
  lrc?: string | null;
  tlyric?: string | null;
  romalrc?: string | null;
  yrc?: string | null;
  instrumental?: boolean;
}

interface TimedText {
  startMs: number;
  text: string;
}

const timeTagPattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\[(?:ar|al|ti|by|re|ve|offset):.*\]$/i;
const yrcHeaderPattern = /^\[(\d+),(\d+)\]/;
const yrcWordPattern = /\((\d+),(\d+),\d+\)([^()]*)/g;

function fractionToMilliseconds(fraction: string | undefined): number {
  if (!fraction) {
    return 0;
  }
  if (fraction.length === 1) {
    return Number(fraction) * 100;
  }
  if (fraction.length === 2) {
    return Number(fraction) * 10;
  }
  return Number(fraction.slice(0, 3));
}

function parseOffset(source: string): number {
  const match = source.match(/^\[offset:([+-]?\d+)\]$/im);
  return match ? Number(match[1]) : 0;
}

function parseTimedText(source: string | null | undefined): TimedText[] {
  if (!source?.trim()) {
    return [];
  }

  const offset = parseOffset(source);
  const entries: TimedText[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timeTagPattern)];
    if (matches.length === 0) {
      continue;
    }

    const text = rawLine.replace(timeTagPattern, "").trim();
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds >= 60) {
        continue;
      }

      entries.push({
        startMs: Math.max(
          0,
          minutes * 60_000
            + seconds * 1_000
            + fractionToMilliseconds(match[3])
            + offset,
        ),
        text,
      });
    }
  }

  return entries.sort((left, right) => left.startMs - right.startMs);
}

function parseYrc(source: string | null | undefined): LyricLine[] {
  if (!source?.trim()) {
    return [];
  }

  const lines: LyricLine[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const header = rawLine.match(yrcHeaderPattern);
    if (!header) {
      continue;
    }

    const startMs = Number(header[1]);
    const durationMs = Number(header[2]);
    const words: LyricWord[] = [];
    let wordMatch: RegExpExecArray | null;
    yrcWordPattern.lastIndex = 0;

    while ((wordMatch = yrcWordPattern.exec(rawLine)) !== null) {
      const rawStart = Number(wordMatch[1]);
      words.push({
        startMs: rawStart >= startMs ? rawStart : startMs + rawStart,
        durationMs: Math.max(0, Number(wordMatch[2])),
        text: wordMatch[3],
      });
    }

    const fallbackText = rawLine.slice(header[0].length).replace(yrcWordPattern, "").trim();
    const text = words.length > 0
      ? words.map((word) => word.text).join("").trim()
      : fallbackText;

    lines.push({
      startMs,
      durationMs: Math.max(0, durationMs),
      text,
      translation: null,
      romanization: null,
      words: words.length > 0 ? words : null,
    });
  }

  return lines.sort((left, right) => left.startMs - right.startMs);
}

function toTimedMap(entries: readonly TimedText[]): ReadonlyMap<number, string> {
  return new Map(entries.map((entry) => [entry.startMs, entry.text]));
}

function deriveDuration(
  entries: readonly TimedText[],
  index: number,
): number | null {
  const next = entries[index + 1];
  return next ? Math.max(0, next.startMs - entries[index].startMs) : null;
}

function plainText(source: string | null | undefined): string[] {
  if (!source?.trim()) {
    return [];
  }

  return source
    .split(/\r?\n/)
    .map((line) => line.replace(timeTagPattern, "").trim())
    .filter((line) => line.length > 0 && !metadataPattern.test(line));
}

export function parseLyrics(input: LyricParseInput): LyricDocument {
  if (input.instrumental) {
    return { kind: "instrumental", lines: [] };
  }

  const original = parseTimedText(input.lrc);
  const wordTimed = parseYrc(input.yrc);
  const translation = toTimedMap(parseTimedText(input.tlyric));
  const romanization = toTimedMap(parseTimedText(input.romalrc));

  const baseLines: LyricLine[] = original.map((entry, index) => ({
    startMs: entry.startMs,
    durationMs: deriveDuration(original, index),
    text: entry.text,
    translation: translation.get(entry.startMs) ?? null,
    romanization: romanization.get(entry.startMs) ?? null,
    words: null,
  }));

  const wordTimedByStart = new Map(wordTimed.map((line) => [line.startMs, line]));
  const syncedLines = baseLines.length > 0
    ? baseLines.map((line) => {
      const yrcLine = wordTimedByStart.get(line.startMs);
      return yrcLine
        ? {
          ...line,
          durationMs: yrcLine.durationMs,
          text: line.text || yrcLine.text,
          words: yrcLine.words,
        }
        : line;
    })
    : wordTimed.map((line) => ({
      ...line,
      translation: translation.get(line.startMs) ?? null,
      romanization: romanization.get(line.startMs) ?? null,
    }));

  if (syncedLines.length > 0) {
    return { kind: "synced", lines: syncedLines };
  }

  const fallback = plainText(input.lrc);
  if (fallback.length > 0) {
    return {
      kind: "plain",
      lines: fallback.map((text) => ({
        startMs: 0,
        durationMs: null,
        text,
        translation: null,
        romanization: null,
        words: null,
      })),
    };
  }

  return { kind: "unavailable", lines: [] };
}

export function findActiveLyricLine(
  lines: readonly LyricLine[],
  currentTimeMs: number,
): number | null {
  let low = 0;
  let high = lines.length - 1;
  let match = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].startMs <= currentTimeMs) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return match >= 0 ? match : null;
}

export function findActiveLyricWord(
  words: readonly LyricWord[] | null,
  currentTimeMs: number,
): number | null {
  if (!words || words.length === 0) {
    return null;
  }

  let low = 0;
  let high = words.length - 1;
  let match = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (words[middle].startMs <= currentTimeMs) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return match >= 0 ? match : null;
}
