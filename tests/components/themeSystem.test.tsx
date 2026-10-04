// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useArtworkThemeTarget } from "../../src/components/ThemeProvider";
import { ThemeSwitcher } from "../../src/components/ThemeSwitcher";
import type { ArtworkPalette } from "../../src/lib/theme/artworkPalette";

const auth = vi.hoisted(() => ({
  state: { status: "ready", mode: "real", user: null as { id: string } | null },
}));
const extraction = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("../../src/features/auth/AuthProvider", () => ({ useAuth: () => auth.state }));
vi.mock("../../src/lib/theme/extractArtworkPalette", () => ({
  extractArtworkPalette: extraction.read,
}));

const palette: ArtworkPalette = {
  primary: "#a1d0b1", secondary: "#bad9c3", surface: "#1c3024",
  raised: "#26392d", overlay: "#304235", onSurface: "#f2f4f0",
  onSurfaceMuted: "#cdd4cb", onPrimary: "#0c0d0d",
};

function Target({ id, url, status = "ready" }: {
  id: string;
  url: string | null;
  status?: "ready" | "loading" | "error";
}) {
  useArtworkThemeTarget({ key: id, status, url });
  return null;
}

function renderTheme(target = <Target id="one" url="/cover-one.png" />) {
  return render(<ThemeProvider><ThemeSwitcher />{target}</ThemeProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  auth.state.status = "ready";
  auth.state.mode = "real";
  auth.state.user = null;
  extraction.read.mockReset();
  extraction.read.mockResolvedValue(palette);
  document.documentElement.dataset.theme = "ink";
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("ThemeProvider and ThemeSwitcher", () => {
  it("keeps a theme change active while reporting a blocked storage write", async () => {
    auth.state.user = { id: "701" };
    const write = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => { throw new Error("quota"); });
    try {
      renderTheme();
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe("artwork"));
      fireEvent.click(screen.getByRole("button", { name: "显示主题" }));
      fireEvent.click(screen.getByRole("button", { name: "浅色" }));
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe("paper"));
      fireEvent.click(screen.getByRole("button", { name: "显示主题" }));
      expect(screen.getByRole("alert")).toHaveTextContent("无法保存主题设置");
    } finally {
      write.mockRestore();
    }
  });

  it("holds guests and Demo sessions in INK while preserving the saved preference", async () => {
    window.localStorage.setItem("echoform:theme-preference", "paper");
    const { rerender } = renderTheme();
    fireEvent.click(screen.getByRole("button", { name: "显示主题" }));
    expect(screen.getByRole("button", { name: "浅色" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "浅色" }))
      .toHaveAttribute("aria-pressed", "true"));
    expect(document.documentElement.dataset.theme).toBe("ink");
    auth.state.user = { id: "701" };
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="one" url="/cover-one.png" /></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("paper"));
    auth.state.mode = "demo";
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="one" url="/cover-one.png" /></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("ink"));
    expect(window.localStorage.getItem("echoform:theme-preference")).toBe("paper");
  });

  it("allows manual selection and restores focus when Escape closes the segmented control", async () => {
    auth.state.user = { id: "701" };
    window.localStorage.setItem("echoform:theme-preference", "ink");
    renderTheme();
    const trigger = screen.getByRole("button", { name: "显示主题" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "浅色" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("paper"));
    expect(window.localStorage.getItem("echoform:theme-preference")).toBe("paper");
    expect(screen.queryByRole("dialog", { name: "显示主题" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "显示主题" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "显示主题" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the old palette until the newest image resolves and ignores an obsolete result", async () => {
    auth.state.user = { id: "701" };
    let releaseFirst: (value: ArtworkPalette | null) => void = () => {};
    let releaseSecond: (value: ArtworkPalette | null) => void = () => {};
    extraction.read
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseSecond = resolve; }));
    const { rerender } = renderTheme();
    await waitFor(() => expect(extraction.read).toHaveBeenCalledTimes(1));
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="two" url="/cover-two.png" /></ThemeProvider>);
    await waitFor(() => expect(extraction.read).toHaveBeenCalledTimes(2));
    releaseFirst(palette);
    expect(document.documentElement.dataset.theme).toBe("ink");
    releaseSecond(palette);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("artwork"));
    expect(document.documentElement.style.getPropertyValue("--ef-artwork-surface")).toBe(palette.surface);
  });

  it("uses INK for missing, failed, or invalid artwork", async () => {
    auth.state.user = { id: "701" };
    extraction.read.mockResolvedValue(null);
    const { rerender } = renderTheme();
    await waitFor(() => expect(extraction.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("ink"));
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="two" status="error" url={null} /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("ink");
  });

  it("forces INK on a failed immersive read even with a saved PAPER preference", async () => {
    auth.state.user = { id: "701" };
    window.localStorage.setItem("echoform:theme-preference", "paper");
    const { rerender } = renderTheme();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("paper"));
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="one" status="error" url={null} /></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("ink"));
    expect(window.localStorage.getItem("echoform:theme-preference")).toBe("paper");
  });

  it("keeps the old artwork palette while the replacement track loads", async () => {
    auth.state.user = { id: "701" };
    const { rerender } = renderTheme();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("artwork"));
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="two" status="loading" url={null} /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("artwork");
    expect(document.documentElement.style.getPropertyValue("--ef-artwork-surface")).toBe(palette.surface);
    rerender(<ThemeProvider><ThemeSwitcher /><Target id="two" status="error" url={null} /></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("ink"));
  });
});
