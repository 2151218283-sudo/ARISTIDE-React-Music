import { describe, expect, it } from "vitest";

import {
  defaultSettings,
  parseSettings,
  serializeSettings,
} from "../../src/features/settings/settingsModel";
import {
  clearSettings,
  readSettings,
  writeSettings,
} from "../../src/features/settings/settingsStorage";

describe("local settings model", () => {
  it("uses explicit defaults for an empty store and round-trips version 1", () => {
    expect(parseSettings(null)).toEqual({ preferences: defaultSettings, issue: null });
    expect(parseSettings(serializeSettings({ ...defaultSettings, quality: "hires" })))
      .toEqual({ preferences: { ...defaultSettings, quality: "hires" }, issue: null });
  });

  it("retains valid fields while repairing corrupt values", () => {
    const parsed = parseSettings(JSON.stringify({
      version: 1,
      quality: "lossless",
      mode: "bad",
      volume: 9,
      rememberVolume: true,
      reducedMotion: true,
      showTranslation: false,
      preferWordTiming: true,
    }));
    expect(parsed).toEqual({
      preferences: {
        ...defaultSettings,
        quality: "lossless",
        reducedMotion: true,
        showTranslation: false,
      },
      issue: "invalid",
    });
    expect(parseSettings("{invalid").issue).toBe("invalid");
    expect(parseSettings('{"version":2}').issue).toBe("future");
  });

  it("does not store the user volume when volume memory is off", () => {
    const raw = serializeSettings({ ...defaultSettings, rememberVolume: false, volume: 0.25 });
    expect(JSON.parse(raw)).toMatchObject({ volume: null, rememberVolume: false });
    expect(parseSettings(raw)).toEqual({
      preferences: { ...defaultSettings, rememberVolume: false, volume: 1 },
      issue: null,
    });
  });

  it("reports blocked reads, writes, and clearing without throwing", () => {
    const blocked = {
      getItem: (): string => { throw new Error("blocked"); },
      setItem: (): void => { throw new Error("blocked"); },
      removeItem: (): void => { throw new Error("blocked"); },
    };
    expect(readSettings(blocked)).toEqual({ ok: false });
    expect(writeSettings(blocked, { ...defaultSettings })).toBe(false);
    expect(clearSettings(blocked)).toBe(false);
    expect(readSettings(null)).toEqual({ ok: false });
  });
});
