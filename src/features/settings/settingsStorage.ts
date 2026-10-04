import {
  parseSettings,
  serializeSettings,
  settingsStorageKey,
  type ParsedSettings,
  type SettingsPreferences,
} from "./settingsModel";

export type SettingsReadResult =
  | { ok: true; value: ParsedSettings }
  | { ok: false };

export function readSettings(storage: Pick<Storage, "getItem"> | null): SettingsReadResult {
  try {
    if (!storage) return { ok: false };
    return { ok: true, value: parseSettings(storage.getItem(settingsStorageKey)) };
  } catch {
    return { ok: false };
  }
}

export function writeSettings(
  storage: Pick<Storage, "setItem"> | null,
  preferences: SettingsPreferences,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(settingsStorageKey, serializeSettings(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearSettings(storage: Pick<Storage, "removeItem"> | null): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(settingsStorageKey);
    return true;
  } catch {
    return false;
  }
}
