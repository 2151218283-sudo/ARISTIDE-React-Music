# Discovery Landing Component Specification

> Status: T017 implementation specification
> Scope: new-song and popular-playlist discovery shown only when `/search` has
> no query. This is a quiet secondary discovery surface, not a new navigation
> page or homepage gallery.

## Ownership

- `SearchExperience` continues to own search URL state and query results.
- `SearchDiscoveryLanding` in `src/features/search/` owns the empty-query
  discovery reads, subsection retries, and discovery presentation.
- The component consumes normalized `Track` and `Playlist` data returned from
  same-origin BFF routes. It does not call an upstream API, store a source URL,
  or create an Audio element.

## BFF Contract

- `GET /api/discovery/new-songs?limit=12` returns a bounded normalized Track
  list with public metadata cache headers.
- `GET /api/discovery/popular-playlists?limit=8&offset=0` returns a normalized
  Playlist page. The landing renders only its first page in T017; playlist
  detail and write operations stay deferred to their own tasks.
- Requests start only while the search query is empty. Typing a query aborts
  outstanding discovery reads and makes the normal search lifecycle dominant.
- The two requests use independent recovery. A successful new-song section
  remains visible if popular playlists fail, and vice versa.

## Presentation And Interaction

- The heading explains supported keyword search without fake history or a fake
  hot-search ranking. Below it, `新歌` renders TrackRows and `热门歌单` renders
  unframed responsive PlaylistTiles.
- New-song row playback stays on `/search`, creates a finite local queue, and
  uses the existing source-resolution behavior. Unavailable tracks remain
  discoverable and truthful.
- Playlist tiles navigate only to local `/playlist/[id]`; no external player,
  source-site link, or claim of completed playlist-detail data is introduced.
- No WebGL canvas, decorative hero card, or continuous animation is used. The
  surface follows the existing search content-scroll layout and token system.

## State Matrix And Tests

| State | Required behavior |
| --- | --- |
| Initial 0-300ms | Keep the search input usable; do not flash a spinner. |
| Loading | Reserve track rows and tiles with stable skeleton dimensions. |
| Both success | Render new Tracks and local PlaylistTiles. |
| One subsection error | Preserve the successful section and expose a named local retry. |
| Both empty | Explain that no public discovery data is currently available and focus the search recovery action. |
| Both error | Show the normalized local error and retry without fabricating items. |
| Query begins | Abort discovery requests and render only the search lifecycle. |

Component tests cover loading, empty, partial failure, retry, playback, local
links, and request cancellation. E2E covers desktop, tablet, mobile, keyboard
focus, Reduced Motion, and no horizontal overflow.
