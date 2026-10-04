// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import { LyricsViewport } from "../../src/features/player/LyricsViewport";
import { SettingsExperience } from "../../src/features/settings/SettingsExperience";
import { SettingsProvider } from "../../src/features/settings/SettingsProvider";
import { settingsStorageKey } from "../../src/features/settings/settingsModel";

const theme = vi.hoisted(() => ({
  available: true,
  effective: "ink" as const,
  preference: "ink" as const,
  hydrated: true,
  storageError: null as string | null,
  setPreference: vi.fn(),
  setArtworkTarget: vi.fn(),
}));

vi.mock("../../src/components/ThemeProvider", () => ({ useTheme: () => theme }));

function renderSettings() {
  return render(
    <SettingsProvider>
      <PlayerProvider sourceResolver={async () => { throw new Error("No source in this test"); }}>
        <SettingsExperience />
      </PlayerProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  theme.storageError = null;
  theme.setPreference.mockReset();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("settings experience", () => {
  it("applies translation and word-timing preferences to existing lyrics", async () => {
    const lyrics = {
      status: "ready" as const,
      error: null,
      retry: () => undefined,
      data: {
        kind: "synced" as const,
        lines: [{
          startMs: 1_000,
          durationMs: 2_000,
          text: "First line",
          translation: "第一行",
          romanization: null,
          words: [
            { startMs: 1_000, durationMs: 900, text: "First " },
            { startMs: 1_900, durationMs: 1_100, text: "line" },
          ],
        }],
      },
    };
    render(<SettingsProvider><PlayerProvider sourceResolver={async () => { throw new Error("unused"); }}>
      <SettingsExperience /><LyricsViewport lyrics={lyrics} />
    </PlayerProvider></SettingsProvider>);
    await screen.findByRole("heading", { name: "设置" });
    const line = screen.getByRole("button", { name: /First line/ });
    expect(line.querySelectorAll("span")).toHaveLength(4);
    fireEvent.click(screen.getByRole("switch", { name: /显示翻译/ }));
    expect(screen.queryByText("第一行")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /优先逐字歌词/ }));
    expect(line.querySelectorAll("span")).toHaveLength(2);
    expect(line).toHaveTextContent("First line");
  });

  it("hydrates preferences and applies immediate controls without a save button", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "设置" });
    fireEvent.click(screen.getByRole("radio", { name: "无损" }));
    fireEvent.click(screen.getByRole("radio", { name: "随机播放" }));
    fireEvent.click(screen.getByRole("switch", { name: /显示翻译/ }));
    fireEvent.click(screen.getByRole("switch", { name: /减少动态/ }));
    const stored = JSON.parse(window.localStorage.getItem(settingsStorageKey) ?? "null");
    expect(stored).toMatchObject({
      version: 1,
      quality: "lossless",
      mode: "shuffle",
      showTranslation: false,
      reducedMotion: true,
    });
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });

  it("recovers damaged fields and shows an inline recovery message", async () => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({
      version: 1,
      quality: "hires",
      mode: "unknown",
    }));
    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("已损坏");
    expect(screen.getByRole("radio", { name: "Hi-Res" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "顺序播放" })).toBeChecked();
  });

  it("keeps a failed write active in memory and reports it beside the setting", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "设置" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("radio", { name: "无损" }));
    expect(screen.getByRole("radio", { name: "无损" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败");
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull();
  });

  it("starts and cancels a duration timer without persisting it", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "设置" });
    fireEvent.click(screen.getByRole("button", { name: "开始计时" }));
    await waitFor(() => expect(screen.getByText(/剩余 15:/)).toBeInTheDocument());
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(screen.getByText("未设置定时停止")).toBeInTheDocument();
  });
});
