import type { AudioQuality } from "@/lib/music/models";
import type { PlaybackMode } from "@/lib/player";

export interface SettingsPreferences {
  reducedMotion: boolean;
  quality: AudioQuality;
  mode: PlaybackMode;
  rememberVolume: boolean;
  volume: number;
  showTranslation: boolean;
  preferWordTiming: boolean;
}

export const defaultSettings: Readonly<SettingsPreferences> = {
  reducedMotion: false,
  quality: "standard",
  mode: "sequential",
  rememberVolume: true,
  volume: 1,
  showTranslation: true,
  preferWordTiming: true,
};

export const settingsStorageKey = "echoform:settings:v1";

export type SettingsIssue = "invalid" | "future" | null;

export interface ParsedSettings {
  preferences: SettingsPreferences;
  issue: SettingsIssue;
}

const qualities: readonly AudioQuality[] = ["standard", "exhigh", "lossless", "hires"];
const modes: readonly PlaybackMode[] = ["sequential", "shuffle", "repeat-one"];

export function parseSettings(raw: string | null): ParsedSettings {
  if (raw === null) {
    return { preferences: { ...defaultSettings }, issue: null };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { preferences: { ...defaultSettings }, issue: "invalid" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { preferences: { ...defaultSettings }, issue: "invalid" };
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return {
      preferences: { ...defaultSettings },
      issue: typeof record.version === "number" && record.version > 1 ? "future" : "invalid",
    };
  }

  let invalid = false;
  const booleanField = (key: keyof SettingsPreferences, fallback: boolean): boolean => {
    if (typeof record[key] === "boolean") return record[key];
    invalid = true;
    return fallback;
  };
  const quality = qualities.find((item) => item === record.quality);
  const mode = modes.find((item) => item === record.mode);
  if (!quality || !mode) invalid = true;
  const volume = typeof record.volume === "number"
    && Number.isFinite(record.volume)
    && record.volume >= 0
    && record.volume <= 1
    ? record.volume
    : null;
  const rememberVolume = booleanField("rememberVolume", defaultSettings.rememberVolume);
  if (volume === null && rememberVolume) invalid = true;

  return {
    preferences: {
      reducedMotion: booleanField("reducedMotion", defaultSettings.reducedMotion),
      quality: quality ?? defaultSettings.quality,
      mode: mode ?? defaultSettings.mode,
      rememberVolume,
      volume: volume ?? defaultSettings.volume,
      showTranslation: booleanField("showTranslation", defaultSettings.showTranslation),
      preferWordTiming: booleanField("preferWordTiming", defaultSettings.preferWordTiming),
    },
    issue: invalid ? "invalid" : null,
  };
}

export function serializeSettings(preferences: SettingsPreferences): string {
  return JSON.stringify({
    version: 1,
    ...preferences,
    volume: preferences.rememberVolume ? preferences.volume : null,
  });
}
