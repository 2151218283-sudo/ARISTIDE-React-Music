// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={typeof href === "string" ? href : ""}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

import { AvatarButton } from "../../src/features/auth/AvatarButton";
import { ProfileExperience } from "../../src/features/profile/ProfileExperience";
import { requestProfileAvatarTransition } from "../../src/features/profile/profileAvatarTransition";
import type {
  UserPlaylistCollection,
  UserProfile,
  UserProfileOverview,
} from "../../src/lib/music/models";

const profile: UserProfile = {
  id: "701",
  nickname: "Profile Listener",
  avatarUrl: "https://example.invalid/profile-avatar",
  signature: "Synthetic profile signature.",
};

const overview: UserProfileOverview = {
  profile,
  isCurrentUser: true,
  recentPlays: { state: "unavailable", reason: "upstream-not-verified" },
};

const collection: UserPlaylistCollection = {
  liked: {
    id: "801",
    name: "Liked Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "public",
    trackCount: 3,
    createdAt: null,
    updatedAt: null,
  },
  created: [{
    id: "802",
    name: "Created Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "public",
    trackCount: 2,
    createdAt: null,
    updatedAt: null,
  }],
  subscribed: [],
};

function success(data: unknown): Response {
  return Response.json({ ok: true, data });
}

function failure(code: string, message: string, retryable: boolean, status: number): Response {
  return Response.json({
    ok: false,
    error: { code, message, retryable, requestId: "profile-component-test" },
  }, { status });
}

function fetchFor(
  profileResponse: () => Promise<Response>,
  playlistsResponse: () => Promise<Response>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    return path.includes("/playlists") ? playlistsResponse() : profileResponse();
  });
}

beforeEach(() => {
  navigation.push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProfileExperience", () => {
  it("renders the current-user profile, local playlist links, and the truthful recent-play state", async () => {
    vi.stubGlobal("fetch", fetchFor(
      async () => success(overview),
      async () => success(collection),
    ));

    render(<ProfileExperience userId="701" />);

    expect(await screen.findByRole("heading", { name: "Profile Listener" })).toBeVisible();
    expect(screen.getByText("Synthetic profile signature.")).toBeVisible();
    expect(screen.getByRole("link", { name: "打开个人设置" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "查看歌单 Liked Signals" }))
      .toHaveAttribute("href", "/playlist/801");
    expect(screen.getByRole("link", { name: "查看歌单 Created Signals" }))
      .toHaveAttribute("href", "/playlist/802");
    expect(screen.getByText("暂时没有可展示的收藏歌单。")).toBeVisible();
    expect(screen.getByText("当前上游读取契约尚未验证，因此未展示任何播放记录。")).toBeVisible();
  });

  it("uses a stable skeleton after the delayed loading threshold", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ProfileExperience userId="701" />);

    expect(screen.queryByRole("status", { name: "正在加载用户主页" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(screen.getByRole("status", { name: "正在加载用户主页" })).toBeVisible();
  });

  it("renders a recoverable local 404 without fabricating profile data", async () => {
    vi.stubGlobal("fetch", fetchFor(
      async () => failure("USER_NOT_FOUND", "Synthetic missing profile.", false, 404),
      async () => success(collection),
    ));
    render(<ProfileExperience userId="999" />);

    expect(await screen.findByRole("heading", { name: "未找到用户" })).toBeVisible();
    expect(screen.queryByText("Profile Listener")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("keeps valid profile metadata when the playlist collection is protected and recovers a retryable collection failure", async () => {
    let playlistAttempt = 0;
    vi.stubGlobal("fetch", fetchFor(
      async () => success({ ...overview, isCurrentUser: false }),
      async () => {
        playlistAttempt += 1;
        return playlistAttempt === 1
          ? failure("UPSTREAM_UNAVAILABLE", "Synthetic upstream failure.", true, 502)
          : success({ liked: null, created: [], subscribed: [] });
      },
    ));
    render(<ProfileExperience userId="701" />);

    expect(await screen.findByRole("heading", { name: "Profile Listener" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "无法加载用户歌单" })).toBeVisible();
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂时没有可公开展示的喜欢音乐。")).toBeVisible();
    expect(screen.queryByRole("link", { name: "打开个人设置" })).toBeNull();
    expect(playlistAttempt).toBe(2);
  });

  it("uses an initial fallback when the profile avatar image fails", async () => {
    vi.stubGlobal("fetch", fetchFor(
      async () => success(overview),
      async () => success(collection),
    ));
    render(<ProfileExperience userId="701" />);

    const image = await screen.findByRole("img", { name: "Profile Listener的头像" });
    const avatarImage = image.querySelector("img");
    expect(avatarImage).not.toBeNull();
    fireEvent.error(avatarImage as HTMLImageElement);
    expect(await screen.findByLabelText("Profile Listener的头像加载失败")).toHaveTextContent("P");
  });

  it("cancels an in-progress avatar transition and omits it in Reduced Motion", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    vi.stubGlobal("fetch", fetchFor(
      async () => success(overview),
      async () => success(collection),
    ));
    const { container, rerender } = render(
      <>
        <AvatarButton user={profile} />
        <ProfileExperience userId="701" />
      </>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Profile Listener的个人主页" }));
    await screen.findByRole("heading", { name: "Profile Listener" });
    await waitFor(() => expect(container.querySelector("[data-running='true']")).not.toBeNull());
    fireEvent.wheel(window);
    await waitFor(() => expect(container.querySelector("[data-running='true']")).toBeNull());
    expect(requestAnimationFrame).toHaveBeenCalled();

    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    requestProfileAvatarTransition(profile.id);
    rerender(<ProfileExperience userId="701" />);
    await screen.findByRole("heading", { name: "Profile Listener" });
    expect(container.querySelector("[data-running='true']")).toBeNull();
  });
});
