import { describe, expect, it, vi } from "vitest";

import {
  createProfileReadRouteHandlers,
  type ProfileReadProvider,
} from "../../src/lib/music/profileBff";
import { AppError } from "../../src/lib/music/errors";
import type { UserPlaylistCollection, UserProfile } from "../../src/lib/music/models";

const profile: UserProfile = {
  id: "701",
  nickname: "Profile Listener",
  avatarUrl: "https://example.invalid/profile-avatar",
  signature: "Synthetic profile signature.",
};

const collection: UserPlaylistCollection = {
  liked: {
    id: "801",
    name: "Liked Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "private",
    trackCount: 3,
    createdAt: null,
    updatedAt: null,
  },
  created: [{
    id: "802",
    name: "Private Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "private",
    trackCount: 2,
    createdAt: null,
    updatedAt: null,
  }, {
    id: "803",
    name: "Public Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "public",
    trackCount: 4,
    createdAt: null,
    updatedAt: null,
  }],
  subscribed: [{
    id: "804",
    name: "Subscribed Signals",
    description: null,
    artworkUrl: null,
    owner: null,
    visibility: "public",
    trackCount: 5,
    createdAt: null,
    updatedAt: null,
  }],
};

function createProvider(
  overrides: Partial<ProfileReadProvider> = {},
): ProfileReadProvider {
  return {
    getUserProfile: async () => profile,
    getUserPlaylists: async () => collection,
    ...overrides,
  };
}

function createHandlers(
  provider: ProfileReadProvider,
  overrides: Partial<Parameters<typeof createProfileReadRouteHandlers>[0]> = {},
) {
  let requestNumber = 0;
  return createProfileReadRouteHandlers({
    createProvider: () => provider,
    createRequestId: () => `profile-request-${++requestNumber}`,
    now: () => 1_700_000_000_000,
    random: () => 0,
    retryDelay: async () => undefined,
    ...overrides,
  });
}

describe("profile BFF read routes", () => {
  it("returns a whitelisted profile overview with a truthful unavailable recent-play state", async () => {
    const getUserProfile = vi.fn<ProfileReadProvider["getUserProfile"]>(async () => profile);
    const handlers = createHandlers(createProvider({ getUserProfile }), {
      resolveContext: () => ({ currentUser: profile, upstreamCookie: "server-only-cookie" }),
    });

    const response = await handlers.profile(
      new Request("http://localhost/api/users/701"),
      "701",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBe("profile-request-1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        profile,
        isCurrentUser: true,
        recentPlays: { state: "unavailable", reason: "upstream-not-verified" },
      },
      meta: {
        requestId: "profile-request-1",
        mode: "real",
        fetchedAt: "2023-11-14T22:13:20.000Z",
      },
    });
    expect(getUserProfile).toHaveBeenCalledWith("701", "server-only-cookie");
  });

  it("validates the profile identifier and page query before creating a provider", async () => {
    const provider = createProvider();
    const createProviderMock = vi.fn(() => provider);
    const handlers = createProfileReadRouteHandlers({
      createProvider: createProviderMock,
      createRequestId: () => "invalid-profile-request",
    });

    const responses = await Promise.all([
      handlers.profile(new Request("http://localhost/api/users/not-an-id"), "not-an-id"),
      handlers.playlists(new Request("http://localhost/api/users/701/playlists?limit=0"), "701"),
      handlers.playlists(new Request("http://localhost/api/users/701/playlists?offset=-1"), "701"),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR", requestId: "invalid-profile-request" },
      });
    }
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("maps a missing user to a local 404 and preserves a protected profile collection boundary", async () => {
    const missingHandlers = createHandlers(createProvider({
      getUserProfile: async () => {
        throw new AppError("USER_NOT_FOUND", "Synthetic missing user.");
      },
    }));
    const missing = await missingHandlers.profile(
      new Request("http://localhost/api/users/999"),
      "999",
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "USER_NOT_FOUND", retryable: false },
    });

    const protectedHandlers = createHandlers(createProvider({
      getUserPlaylists: async () => {
        throw new AppError("AUTH_REQUIRED", "Synthetic protected collection.");
      },
    }));
    const protectedResponse = await protectedHandlers.playlists(
      new Request("http://localhost/api/users/701/playlists"),
      "701",
    );
    expect(protectedResponse.status).toBe(401);
    await expect(protectedResponse.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED", retryable: false },
    });
  });

  it("filters private playlists for a guest while retaining them for the current user", async () => {
    const guestHandlers = createHandlers(createProvider());
    const guestResponse = await guestHandlers.playlists(
      new Request("http://localhost/api/users/701/playlists?limit=30&offset=0"),
      "701",
    );
    await expect(guestResponse.json()).resolves.toMatchObject({
      ok: true,
      data: {
        liked: null,
        created: [{ id: "803", visibility: "public" }],
        subscribed: [{ id: "804", visibility: "public" }],
      },
    });

    const currentHandlers = createHandlers(createProvider(), {
      resolveContext: () => ({ currentUser: profile }),
    });
    const currentResponse = await currentHandlers.playlists(
      new Request("http://localhost/api/users/701/playlists"),
      "701",
    );
    await expect(currentResponse.json()).resolves.toMatchObject({
      ok: true,
      data: collection,
    });
  });

  it("retries a retryable user read once with the same request identity", async () => {
    const getUserPlaylists = vi.fn<ProfileReadProvider["getUserPlaylists"]>()
      .mockRejectedValueOnce(new AppError("RATE_LIMITED", "Synthetic rate limit.", {
        retryable: true,
      }))
      .mockResolvedValueOnce(collection);
    const retryDelay = vi.fn(async () => undefined);
    const handlers = createHandlers(createProvider({ getUserPlaylists }), { retryDelay });

    const response = await handlers.playlists(
      new Request("http://localhost/api/users/701/playlists"),
      "701",
    );

    expect(response.status).toBe(200);
    expect(getUserPlaylists).toHaveBeenCalledWith("701", { limit: 30, offset: 0 }, undefined);
    expect(getUserPlaylists).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledWith(100);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      meta: { requestId: "profile-request-1" },
    });
  });
});
