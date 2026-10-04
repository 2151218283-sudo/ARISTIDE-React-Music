# Library Write Specification

> Status: T021 implementation specification

## Scope and ownership

- T021 owns only liking tracks and collecting albums. Playlist collection remains
  blocked by the verified upstream HTTP 405 and belongs to T022 only if its
  contract becomes usable.
- `src/lib/music/libraryWriteBff.ts` owns normalized read/write envelopes,
  authentication, the no-retry boundary, and per-session mutation idempotency.
- `src/lib/music/netease/adapter.ts` is the only Real Provider boundary for
  `like`, `likelist`, `album_sub`, and `album_sublist`.
- `src/features/library/LibraryMutationProvider.tsx` owns the short-lived
  in-memory client snapshot and the `echoform:library-changed` event. It never
  stores an upstream Cookie, QR value, audio URL, or raw provider response.
- Track, album, preview, profile, and library components consume the shared
  mutation state. They do not call a Provider or upstream API directly.

## Same-origin API contract

All routes return the existing `ApiResult` envelope and `Cache-Control: no-store`.
The browser sends only the ECHOFORM `sid` Cookie and a random
`clientMutationId`; it never sends an upstream Cookie.

| Method | Route | Auth | Success data |
| --- | --- | --- | --- |
| `GET` | `/api/library/likes?limit=50&offset=0` | Real login or explicit Demo mode | `CatalogPage<Track>` |
| `GET` | `/api/library/albums?limit=50&offset=0` | Real login or explicit Demo mode | `CatalogPage<AlbumSummary>` |
| `PUT` | `/api/library/likes/:id` | Real login or explicit Demo mode | `{ kind: "track-like", id, active: true }` |
| `DELETE` | `/api/library/likes/:id` | Real login or explicit Demo mode | `{ kind: "track-like", id, active: false }` |
| `PUT` | `/api/library/albums/:id` | Real login or explicit Demo mode | `{ kind: "album-collection", id, active: true }` |
| `DELETE` | `/api/library/albums/:id` | Real login or explicit Demo mode | `{ kind: "album-collection", id, active: false }` |

The write body is exactly `{ clientMutationId: string }`. Real-provider IDs are
decimal strings of at most 20 digits. Explicit Demo mode also accepts the
deterministic fixture IDs beginning with `demo-`; these IDs never reach the
upstream provider. Mutation IDs are 16–128 URL-safe characters and
are required for every write. A repeated ID for the same Session and operation
returns the first normalized result without another Provider call. Reusing an
ID for a different operation is a validation error.

Real mode requires both the current Session user and its server-only upstream
Cookie. Demo mode uses an explicit Session mode and an in-memory session-scoped
fixture; it never claims to update网易云 or to authenticate a user. A guest in
Real mode receives `401 AUTH_REQUIRED`, and the client opens the existing QR
dialog while retaining the previous visible state.

## Provider boundary

The pinned Legacy `4.32.0` adapter calls only the T020 verified paths:

- `like({ id, like: 1 | 0, cookie })` for track mutations;
- `likelist({ uid, cookie })` followed by bounded `song_detail` reads for the
  current user's liked tracks;
- `album_sub({ id, t: 1 | 0, cookie })` for album mutations;
- `album_sublist({ limit, offset, cookie })` for saved album summaries.

The adapter treats non-200 transport or business responses as a normalized
failure. BFF writes call the Provider once and never retry automatically. The
verified `playlist_subscribe` 405 is outside this contract and must not be
used as a fallback.

## Client state and cross-surface consistency

- The shared Provider loads liked tracks and saved albums after Auth becomes
  ready, and resets them on logout or a mode change.
- A write remains `pending` until the server returns success. It disables the
  exact action and ignores repeated clicks while pending.
- Success updates the shared ID sets and emits `echoform:library-changed`.
  `/library` refreshes its list data; `/profile/:id` refreshes its collection
  summary when it is the current user; track and album actions read the same
  state immediately.
- A failed write leaves the previous state intact and renders an inline error
  with a deliberate retry action. A timeout is not retried by the BFF.
- An expired Session maps to `SESSION_EXPIRED` or `AUTH_REQUIRED`, opens QR
  login, and never labels the entity as liked or collected.

## UI state matrix

Each action must cover:

1. anonymous Real mode: QR login action and no state mutation;
2. restoring/authenticated: stable control geometry with a local busy state;
3. Demo success and Real success: state changes only after confirmation;
4. cancel/unlike or uncollect: same pending and success rules;
5. repeated click: one request only;
6. validation, 401/session expiry, upstream failure, and timeout: inline reason,
   preserved prior state, and a deliberate retry;
7. cross-surface refresh: current track/album, library tab, and current profile
   agree after the shared event;
8. keyboard focus, 44px hit area, `aria-pressed`, `aria-busy`, and Reduced
   Motion behavior at 1440×900, 768×1024, and 390×844.

The control uses a heart icon for a track and a bookmark/collection icon for an
album, with text labels available to assistive technology. A success toast is
optional; it cannot be the only error or success feedback.

## Verification boundary

- Unit tests cover ID and mutation validation, adapter parameter mapping,
  normalized error handling, Demo session state, and idempotency.
- Contract tests cover every read/write route, no-store headers, auth/mode
  boundaries, no automatic retry, repeated mutation IDs, and safe envelopes.
- Component tests cover the full state matrix and shared event refresh without
  any network call to an upstream service.
- Local Playwright tests cover QR opening, Demo/Real success and failure,
  cross-surface consistency, and the three baseline viewports. No live Provider
  or external write is part of the default suite.

