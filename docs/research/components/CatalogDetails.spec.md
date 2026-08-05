# Catalog Details Component Specification

> Status: T017 implementation specification
> Scope: normalized public album and artist detail reads, local detail pages,
> bounded playback queues, and catalog list pagination.

## Ownership

- `src/app/album/[id]/page.tsx` and `src/app/artist/[id]/page.tsx` resolve only
  local route parameters and render `CatalogDetailPage`.
- `src/features/catalog/` owns same-origin reads, loading/retry state, local
  pagination state, detail-page composition, and catalog-specific styles.
- `src/components/TrackRow.tsx` is promoted from its T016 search-only use after
  this second product use. It renders normalized Tracks only and never fetches
  provider data or owns an Audio element.
- `src/components/PlaylistTile.tsx` renders a normalized Playlist as a local
  `/playlist/[id]` link. It does not claim that playlist detail or write
  actions are available before their dedicated tasks.
- Route pages, features, and components consume normalized models only. No
  client code imports an upstream adapter, reads a Cookie, or receives a source
  URL.

## BFF Contract

- `GET /api/albums/:id` returns `ApiResult<AlbumDetail>` with public metadata
  cache headers. `id` is a decimal identifier of at most 20 digits.
- `GET /api/artists/:id?limit=20&offset=0` returns
  `ApiResult<ArtistDetail>`. Its album list uses a validated `1..30` limit and
  non-negative offset; hot tracks are capped by the selected provider.
- A missing album or artist maps to the existing normalized unavailable/404
  state. Invalid input maps to `VALIDATION_ERROR`; a provider failure maps to
  the existing retryable BFF error. Upstream response fields never pass
  through.
- Album tracks are received as one normalized detail document. The UI renders
  them in 50-row local segments, retaining already visible rows while more are
  revealed. Artist albums use provider pagination and append only a unique next
  page.

## Page Content And Playback

- Album pages show artwork, name, linked artists, publication date when known,
  description when present, a primary `播放全部` action, and TrackRows.
- Artist pages show avatar, name, aliases and biography when present, then
  hot Tracks and the artist's album grid. They do not invent similar artists:
  that read contract is outside T017.
- Track links resolve locally to `/track/[id]`; artist and album metadata links
  resolve to local `/artist/[id]` and `/album/[id]` routes. No catalog action
  navigates to the source site.
- A row playback control replaces the active queue with the current visible
  context and remains on the detail page. Album `播放全部` loads the first Track
  not explicitly marked VIP, copyright-restricted, or region-restricted, while
  preserving all normalized tracks as its finite queue. Artist hot-track
  playback uses the same bounded local queue without changing the player state
  machine.
- Explicitly unavailable tracks remain listed with their reason and disabled
  control. `unknown` tracks remain actionable; source resolution is still the
  final availability decision.

## Layout, Motion, And Accessibility

- Both routes use `content-scroll`, not homepage canvas or wheel-to-exit
  behavior. The persistent player reserves the final list space.
- The header is a single unframed editorial band: media, context, title, then
  constrained description. Track lists use separators rather than nested cards.
- Desktop media remains within 42% of the content frame; mobile stacks artwork,
  information, primary action, then content. Metadata collapses before track
  title, artist, play action, or route-back affordance.
- The page H1 is the route focus target. Artwork has meaningful alt text;
  linked entities have clear names; icon controls retain the shared 44px
  `IconButton` label and tooltip contract. Current playback and unavailable
  state have text, not color-only meaning.
- Entry and list reveal use opacity/transform only, at most 300ms. Reduced
  Motion keeps the state order with no spatial displacement.

## State Matrix And Tests

| State | Required behavior |
| --- | --- |
| Loading | Stable header/list skeleton; no full-page spinner. |
| Normal album | Header, playable and unavailable TrackRows, bounded reveal, local links. |
| Normal artist | Header, hot Tracks, album grid, provider album pagination. |
| Empty tracks/albums | Explain the actual missing collection and retain valid header data. |
| 404 | Do not invent catalog metadata; show a local retry/back recovery action. |
| Provider error | Preserve already valid detail data where available and retry the failed read. |
| Partial unplayable | Keep rows visible with reason; `播放全部` starts at the first actionable Track. |
| Long list | Start with 50 album tracks or one 20-item artist album page; append without jumps. |

Contract tests cover validation, envelopes, cache policy, safe error mapping,
and adapter field normalization. Component and E2E tests cover the matrix,
keyboard navigation, playback queues, local links, 1440/768/390 layouts, and
Reduced Motion.
