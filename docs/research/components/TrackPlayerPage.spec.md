# Track Player Page Specification

> Status: T014 implementation specification
> Scope: `/track/[id]` immersive playback page, page-owned public data reads, and the lyrics viewport. Comments and queue Drawer/BottomSheet remain T015.

## Ownership

- `src/app/track/[id]/page.tsx` resolves the route parameter and renders the client feature. It does not fetch upstream data directly.
- `TrackPlayerPage` owns track/lyric BFF reads, page-level loading and recovery states, and connects visual controls to the existing `PlayerProvider`.
- `LyricsViewport` renders a normalized `LyricDocument`; it never creates an Audio element, owns a clock, or derives a fake playback position.
- The root `PlayerProvider` remains the only owner of the persistent Audio element, source URL, transport commands, buffering state, and `currentTimeMs`.

## Data And State

- Read `/api/tracks/:id` and `/api/tracks/:id/lyrics` concurrently through same-origin fetches with one `AbortController` per route ID/retry revision.
- The page skeleton is stable while track data loads. If the detail request fails, render a page-level `StatusView` with retry; do not invent a song.
- Lyrics load independently. A lyrics failure leaves resolved track information and player controls usable, with an inline retry action.
- `synced` data uses word timing when a line has `words`; otherwise it highlights the whole active line. Missing `yrc` is an ordinary line-level fallback.
- `plain`, `instrumental`, and `unavailable` are successful lyric models with truthful copy, not player errors. Translation is rendered as secondary text when present.
- The currently loaded Player track remains the source of transport status. When route data finishes and it is not already current, the primary play action loads the route Track as a one-item manual queue. A route visit alone must not autoplay.

## Lyrics Interaction

- Active line and active word derive from `PlayerPublicSnapshot.currentTimeMs` only. The current position is obtained through the existing external Player store.
- Clicking a synced lyric calls `SEEK_COMMIT` for its `startMs`. Plain/instrumental/unavailable lines are not seekable.
- A user scroll/pointer/touch browse action starts a 5-second browse lock. During the lock, playback continues but automatic centering is suppressed. The visible `回到当前` action clears the lock. The next active-line update after expiry resumes follow behavior.
- Normal motion may use `scrollIntoView({ block: "center", behavior: "smooth" })` for an active line. Reduced Motion uses instant scrolling only. No lyric animation modifies the time calculation.

## Layout And Accessibility

- Desktop uses an unframed two-column stage: artwork and metadata occupy 38%-42% visual width; the lyrics viewport occupies the remaining reading column. The persistent player bar reserves bottom space.
- At tablet width, columns tighten without text overlap. At mobile width, the order is artwork, metadata, controls, then a bounded lyrics viewport; no control overlays lyrics.
- Artwork enters with an opacity/transform handoff limited to the player motion token, and becomes effectively instant under Reduced Motion. The route does not recreate the gallery canvas or Audio host.
- Every icon control uses Lucide and a 44px or larger hit target. Seekable lines expose a button with an action label; current-line state is exposed without color-only meaning. Loading/error messages use local status semantics and do not steal focus.
- `/track/[id]` allows ordinary vertical scrolling. It never registers the gallery wheel-to-exit handler.

## Test Matrix

- Component: track loading, detail error/retry, lyrics loading/error/retry, synced words, ordinary LRC, plain, instrumental, unavailable, seek click, browse lock, reduced motion.
- E2E: route entry, page loading, lyric/source errors, buffering state, seek and immediate highlight update, one Audio DOM node across route navigation, desktop/tablet/mobile and 200% equivalent layout checks.
- Acceptance: `PLAYER-AC-01..05`, `PLAYER-AC-13`, `VIS-AC-09`, no horizontal overflow, and `npm run check` all pass.
