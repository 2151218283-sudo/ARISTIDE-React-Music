# LibraryExperience Component Specification

## Ownership

- Route: `src/app/library/page.tsx` renders `LibraryExperience` only.
- Feature: `src/features/library/` owns the tab state, authenticated collection
  reads, IndexedDB history view, playback-history observation, and library-only
  presentation.
- Local persistence: `src/lib/listeningHistory.ts` owns the versioned
  `echoform-listening-history` IndexedDB schema and its browser adapter. It
  stores only whitelisted normalized track metadata; it never accepts or
  persists `PlaybackSource` or an audio URL.
- Global mount: `ListeningHistoryRecorder` is rendered once beneath
  `PlayerProvider` in `src/app/layout.tsx`. It observes Player snapshots but
  does not own Audio, dispatch playback commands, change the queue, or write
  React state on media-time events.
- The feature consumes normalized `Track`, `Playlist`, and
  `UserPlaylistCollection` models only. It reuses the existing same-origin
  `requestUserPlaylists` client and never calls an upstream API from the
  browser.

## Route And Data Contract

- The canonical route is `/library`. It uses `content-scroll`, a quiet
  task-oriented surface, and no WebGL canvas.
- Tabs are `喜欢`, `专辑`, `歌单`, and `播放记录`. They are native buttons using
  `role="tablist"`, `role="tab"`, `aria-selected`, and a linked
  `role="tabpanel"`. The selected tab remains local to the page; it is not a
  second navigation system.
- Session state is read through `useAuth`. While it is restoring, account tabs
  reserve their final layout with local skeletons. An anonymous user sees an
  honest login-required state with the existing local QR login action and is
  never sent to an external site.
- After login, `喜欢` displays the read-only liked-music playlist returned by
  `/api/users/:id/playlists`. `歌单` displays read-only created and subscribed
  playlists from that same collection. No favorite, collection, playlist, or
  album write action is exposed in T019.
- `专辑` explicitly says that the saved-album read contract has not yet been
  verified. It renders no guessed albums and offers a local recovery action.
- An account-read failure is local to account tabs, retains previously loaded
  collection data, states the failure, and exposes retry. It does not hide a
  successfully loaded local history tab.

## Local History Schema

- Database: `echoform-listening-history`, version `1`.
- Object store: `entries`, primary key `trackId`; an index named `playedAt`
  supports most-recent-first reads.
- Each persisted entry has exactly these product fields:
  `trackId`, `track`, `playedAt`, `playedMs`, `completed`, and `source`.
  `source` is always the literal `local`.
- `track` is a whitelisted snapshot of id, name, artists (id/name only), album
  id/name/artwork, duration, artwork, aliases, explicit flag, availability,
  and privilege. Unknown object properties are discarded. In particular,
  `source`, `url`, `audioUrl`, `PlaybackSource`, cookies, QR values, and raw
  provider fields are not part of the schema.
- `upsert` deduplicates by `trackId`: a later qualified play replaces the
  existing entry for that song and updates `playedAt`, `playedMs`, and
  `completed`. History therefore represents the latest qualified local play,
  not a fabricated count of upstream plays.
- Reads are browser-local and work when `navigator.onLine === false`. The page
  identifies this as `本地离线记录`; it does not imply that account collections
  were refreshed while offline.

## Playback Recording

1. The recorder starts an in-memory session when `loadRevision` or `trackId`
   changes. It observes the existing semantic and timeline subscriptions but
   never writes from every `MEDIA_TIME` event.
2. Only intervals whose previous and current semantic state are `playing` add
   listening time. A seek cannot inflate listened time because each position
   delta is capped by elapsed wall time plus a small media-event tolerance.
3. A session qualifies once listened time reaches 30 seconds or reaches 50% of
   a known duration. It is marked completed only when the playhead reaches the
   end tolerance. The adapter is called at most once for that track-load
   session.
4. The write is fire-and-forget and failure-isolated: a quota or IndexedDB
   failure does not pause playback, alter the audio element, queue, or route.
   Successful writes emit a local `echoform:history-changed` event so an open
   library can refresh without polling.

## History Presentation And Safety Gate

- `播放记录` lists entries by descending `playedAt` with shared `TrackRow`
  controls, a visible `本地记录` source label, the local listen duration, and
  a recent-play timestamp. The list provides queue context `manual` and
  remains fully playable via the existing player.
- The first 50 rows render initially; a local `显示更多` control reveals the
  next segment without replacing prior rows or breaking tab order.
- History loading waits 300ms before showing a same-shape skeleton. Empty
  state says `播放记录会出现在这里` and links locally to discovery. Storage
  failure names local storage, retains prior rows, and exposes retry.
- When at least one history row exists, a `清空记录` action opens a local
  confirmation dialog. The dialog names the exact scope: only the current
  browser's `echoform-listening-history.entries` store is removed; the user
  session, queue, audio source, cookies, and account data remain untouched.
  `取消`, Escape, and focus return leave every row unchanged. The destructive
  confirmation is disabled while the IndexedDB transaction is pending, so it
  cannot create duplicate clear operations.
- A successful clear closes the dialog, replaces the displayed rows with the
  honest empty state, restores focus to the action trigger, and announces the
  result. A failed clear keeps the rows and dialog available, names the local
  storage failure in place, and permits a deliberate retry. The adapter calls
  only `entries.clear()` in a read-write transaction and emits
  `echoform:history-changed` only after that transaction completes.

## Accessibility, Motion, And Tests

- The route heading is the AppShell focus target. Tab order follows the visual
  order. Controls have visible focus, touch targets of at least 44px, and
  controlled live updates that do not steal focus.
- Loading preserves final media and row geometry. Tab changes use a short
  opacity/transform transition only; reduced motion removes displacement.
- Unit tests cover schema version, whitelisted mapping/no audio URL,
  threshold math, seek-capped listening, one-write-per-session, newest-entry
  dedupe, and descending adapter reads.
- Component tests cover anonymous, loading, normal, empty, error, offline,
  history refresh, 50+ item segmentation, tabs, keyboard semantics, and
  history-clear cancel/success/failure/pending states.
- E2E tests intercept only local account reads and verify 1440x900, 768x1024,
  and 390x844 layouts, loading, empty, error, offline history, threshold
  boundaries, duplicate track writes, clear cancel/success, and no unexpected
  horizontal overflow.
