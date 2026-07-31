# SearchExperience Component Specification

## Ownership

- Route: `src/app/search/page.tsx` renders the search experience only.
- Feature: `src/features/search/` owns client query state, BFF decoding, result
  composition, pagination, and search-specific presentation.
- The feature consumes normalized `Track`, `AlbumSummary`, `ArtistSummary`, and
  `SearchResponse` models only. It never imports the Netease adapter or
  upstream response fields.
- `SearchTrackRow` and `SearchEntityTile` stay feature-owned in T016. They can
  move to `src/components/` only after a second real product use exists.

## Route And URL Contract

- The canonical route is `/search?q=<trimmed keyword>&type=all|track|album|artist`.
- `q` is omitted for an empty input. `type` defaults to `all` and is omitted
  from the URL only when no query exists.
- Direct loads, refreshes, browser Back/Forward, and route return restore the
  input text and selected type from the URL. The page does not create a WebGL
  canvas.
- Typing replaces the current URL after the 300ms debounce. An explicit tab
  change creates a local navigation entry. The most recent query and type are
  never derived from DOM text.

## Query Lifecycle

1. Input is usable immediately on page entry and during the 420ms visual
   expansion. The feature waits 300ms after the last text or type change before
   issuing a read request.
2. Every request receives a monotonically increasing revision and an
   `AbortController`. A new request aborts the previous one. A response is
   accepted only when its revision is still current; aborts are silent.
3. From 0-300ms, the existing result remains unchanged. After 300ms, the input
   shows local progress and the result heading announces `正在更新` without
   disabling typing. When no prior result exists, a stable result skeleton is
   shown only after the documented delay.
4. A successful response cross-fades into the same results container. A failed
   response keeps the prior successful result, adds an inline `role="alert"`
   error, and exposes `重试` for the same query. An empty response replaces the
   prior result with the honest empty state and focuses no control.
5. Clearing the input cancels pending work and shows the zero-data search
   landing state. Search history and hot searches are explicitly marked as
   pending discovery data in T016; no fake history or ranking is rendered.

## Result Presentation

- Tabs use native buttons with `role="tablist"`, `role="tab"`,
  `aria-selected`, and an associated `role="tabpanel"`. Visual and keyboard
  order are `综合`, `歌曲`, `歌手`, `专辑`.
- `type=all` renders up to the BFF-provided track, artist, and album sections.
  It has no pagination. A successful section remains visible when another
  section appears in `partialErrors`; the failed section shows a named inline
  error and a retry action. The UI never calls an upstream all-search type.
- `type=track` renders `SearchTrackRow` entries with artwork, title, artists,
  album, duration, availability, current-playback state, route link, and a
  separate play/pause button. `type=album` and `type=artist` render no-shell
  responsive grids of local route links. Missing artwork uses `AlbumArtwork`'s
  neutral fallback.
- Single-type pages fetch at `limit=20`. When `hasMore` is true, `加载更多`
  requests the next offset, retains the existing items while pending, and
  leaves those items in place if that page fails.

## Playback And Navigation

- Activating a track row link navigates locally to `/track/[id]`.
- Its separate playback control dispatches `LOAD_TRACK` with the visible track
  list as a queue and `sourceContext: "search"`; it remains on `/search`.
- The current track exposes text plus an accessible playing state, not color
  alone. Unavailable tracks remain visible and explain why their play control
  is disabled.
- Artist and album links resolve to local `/artist/[id]` and `/album/[id]`
  routes only. No result may navigate to the source portfolio or an external
  music site.

## Accessibility And Motion

- The page heading is the route focus target (`data-page-heading`, `tabIndex=-1`).
  The input has a visible label and `/` focuses it unless focus is already in a
  text-editing control.
- Icon-only play controls use the shared `IconButton` label/tooltip contract;
  all primary targets are at least 44px. Error and progress messaging use
  controlled live regions and do not steal focus.
- Result replacement uses opacity and transform only, lasts no more than the
  search duration token, and is interrupted by subsequent input. Reduced
  motion removes the displacement and shortens transitions while retaining the
  state order.

## State Matrix And Tests

| State | Required behavior |
| --- | --- |
| Empty query | Explain supported search; show honest history/hot-search placeholder. |
| Pending 0-300ms | Keep input and prior result unchanged. |
| Loading | Show local progress and `正在更新`; do not clear old data. |
| All success | Render three typed sections and local navigation/play actions. |
| Partial all success | Preserve successful sections; identify the failed section and retry. |
| Single type success | Render typed list/grid and page forward when `hasMore`. |
| Empty result | Explain no result and offer `修改关键词` by focusing the input. |
| Failure | Explain the BFF error and retry without clearing a prior result. |
| Stale response | Ignore it after a newer revision begins. |

Component tests cover the state matrix, keyboard shortcut, URL restoration,
pagination, player dispatch, and stale-response isolation. Contract tests cover
the normalized BFF envelope and all-search partial failure. E2E tests intercept
only local `/api/search` reads and cover 1440x900, 768x1024, 390x844, loading,
empty, error, partial success, pagination, playback, Back/Forward, and no
horizontal overflow.
