# ECHOFORM Profile Page Specification

> Status: T018 implementation specification
> Scope: read-only user profile, user playlist summaries, and the account-avatar
> transition into the local profile route.

## Ownership

- `src/app/profile/[id]/page.tsx` resolves a local profile identifier and renders
  `ProfileExperience`; it does not call an upstream API or read a Cookie.
- `src/features/profile/` owns same-origin reads, page-state composition,
  profile-specific styles, the avatar transition, and profile client validation.
- `src/lib/music/` owns normalized `UserProfileOverview` and
  `UserPlaylistCollection`, the provider methods, upstream mapping, and BFF
  request handling. Only whitelisted normalized fields reach the browser.
- `AvatarButton` remains the local account entry. It marks an in-memory avatar
  transition request before navigating to `/profile/[id]`; it does not put a user
  ID, avatar URL, Cookie, or account data in browser storage.
- `PlaylistTile` remains a normalized local `/playlist/[id]` link. It may be
  used in the profile grid but owns neither profile fetching nor playlist writes.

## Normalized Read Contract

The profile feature has two independent, same-origin reads. Both use the
existing `ApiResult` envelope and `Cache-Control: no-store`; the browser never
receives raw provider data, upstream Cookie values, QR keys, or private profile
fields.

| Route | Success data | Notes |
| --- | --- | --- |
| `GET /api/users/:id` | `UserProfileOverview` | `id` is a decimal identifier up to 20 digits. It returns only `UserProfile`, an `isCurrentUser` flag, and the explicit recent-play availability state. |
| `GET /api/users/:id/playlists?limit=30&offset=0` | `UserPlaylistCollection` | The adapter derives liked, created, and subscribed summaries from `user_playlist` without exposing `creator`, `specialType`, subscription data, or raw rows. |

`UserProfile` remains limited to `id`, `nickname`, `avatarUrl`, and `signature`.
`UserProfileOverview.recentPlays` is `{ state: "unavailable", reason:
"upstream-not-verified" }` in T018 because no verified read contract exists for
recent playback. The UI must state that fact and must not construct tracks,
taste scores, dates, counts, or rankings.

`UserPlaylistCollection` is `{ liked, created, subscribed }`. `liked` is
derived only from the upstream special-playlist marker, never from a localized
playlist name. Created and subscribed lists are bounded summaries; their
playlist detail and any write action remain outside T018.

Invalid identifiers return `VALIDATION_ERROR`. A missing user maps to
`USER_NOT_FOUND` and HTTP 404. A protected or unauthorized collection maps to
the existing auth failure envelope. Retryable transport failures use the
existing normalized retry policy. If profile metadata succeeds while playlists
fail, the valid profile remains visible and only the playlist region exposes
retry.

## Content And States

The profile is a `content-scroll` page. Its first viewport contains the avatar,
nickname, optional signature, the liked-music entry when available, and a
playlist summary. It is a music-persona page, not a conventional social profile
or a statistics dashboard.

| State | Required behavior |
| --- | --- |
| Initial (0-300ms) | Keep the application shell stable and do not flash a page spinner. |
| Loading | Reserve the avatar, title, and playlist grid dimensions with local Skeletons. |
| Public user | Render normalized profile, liked entry when present, created and subscribed playlist summaries, and the truthful unavailable recent-play section. |
| Current user | Mark the page as the current user's profile and show the local Settings entry. No edit control is introduced. |
| Guest visitor | Public profile remains readable. Do not imply account ownership or show Settings. |
| No liked playlist / empty collections | Keep valid profile metadata and state the missing collection without fabricating a playlist. |
| Protected collection | Keep valid profile metadata and explain that this collection is not public; provide local retry when the failure is retryable. |
| 404 | Do not show profile metadata; provide local home recovery. |
| Profile route error | Show the normalized inline reason and retry. |
| Playlist route error | Keep the profile visible; only the playlist region has the error and retry action. |
| Avatar image failure | Use the first nickname character inside the existing neutral circular boundary. |

## Layout, Motion, And Accessibility

- Use the existing INK/PAPER/ARTWORK tokens, unframed editorial bands, and
  1:1 `PlaylistTile` media. Do not introduce raw color values, decorative
  gradients, light orbs, nested cards, a WebGL canvas, or a statistics grid.
- The avatar is the visual origin. A navigation click from `AvatarButton` uses
  a fixed, circular clone that moves from the source avatar bounds to the page
  header avatar over approximately 600ms using a transform-only translation
  and scale.
  It never creates a full-screen circular mask.
- The transition is skipped for Reduced Motion and is cancellable immediately
  by pointer, wheel, touch, or keyboard interaction. Cancellation removes only
  the clone and leaves the destination page usable.
- Content hierarchy enters once with opacity/transform, in document order, at
  no more than 300ms. Reduced Motion keeps the final order without spatial
  displacement.
- The route H1 is focusable programmatically after in-app navigation. Controls
  keep visible focus rings, links have descriptive labels, avatar fallback has
  accessible text, and all touch targets are at least 44px.
- Desktop uses a constrained 1120px content frame. Tablet uses a three-column
  playlist grid where space permits; mobile uses two columns without horizontal
  overflow. The persistent player space remains reserved at the bottom.

## Test Boundary

Contract tests cover identifier validation, safe envelopes, `no-store`,
current-user determination, whitelisted normalization, liked derivation,
404/auth/error mapping, and no Cookie or raw upstream fields in responses.
Unit tests cover adapter/profile collection normalization and demo behavior.
Component tests cover the state matrix, partial preservation, local links,
avatar fallback, transition cancellation, keyboard focus, and Reduced Motion.
E2E covers public/current/guest profile states, loading, empty, protected,
404, error, avatar failure, 1440px/768px/390px layout, and no horizontal
overflow. Tests use only synthetic values and local route interception.
