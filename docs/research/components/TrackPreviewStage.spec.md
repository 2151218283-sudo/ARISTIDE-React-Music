# TrackPreviewStage Specification

## Ownership

- Target: `src/features/discovery/TrackPreviewStage.tsx` and its local styles.
- Parent state machine: `src/components/HomeExperience.tsx`.
- Shared-cover geometry: `src/lib/webgl/filmstripScene.ts`.
- Data boundary: normalized `Track` and same-origin `/api/tracks/[id]` reads only.
- T013 does not implement the full `/track/[id]` playback page, synchronized
  lyrics, comments drawer, like mutation, or any upstream write.

## State Machine

- Phase is `hidden | entering | visible | exiting`.
- Selecting a Track immediately sets the preview Track and enters `entering`.
  A second selection before React settles replaces the target; no intermediate
  Track may later reopen or play.
- Entry targets 1100ms and must finish within 1600ms. Metadata begins after
  400ms; playback and `EXPLORE` become visible after 600ms, but their semantic
  controls exist and accept input from the first entering frame.
- Exit targets 500ms. Wheel, Escape, counter, and visible back control all call
  one idempotent close action. Exit may interrupt entry without jumping.
- The first non-zero wheel event during `entering` or `visible` is prevented and
  only starts exit. It cannot contribute to the restored gallery offset or wave.
- Reduced Motion keeps the same phases and controls but uses near-immediate
  spatial transitions and no stagger delay.

## Shared Artwork

- The WebGL film item remains the sole artwork object in normal Canvas mode.
  The selected mesh reuses its existing texture and geometry, expands from its
  current position, and restores a complete 1:1 crop without a DOM image swap.
- Neighbour meshes move away from the selected item. At the first or last Track,
  only real neighbours render; the sequence never wraps.
- Exiting reverses the same progress and keeps the pre-entry gallery offset.
- Canvas initialization failure uses the existing finite DOM gallery and a DOM
  `AlbumArtwork` preview fallback. It remains keyboard and touch operable.

## Content And Controls

- Show sequence/total, Track name, artists, album, duration, availability,
  play/pause, a disabled like placeholder, a three-line lyric summary area,
  visible back control, and `EXPLORE`.
- `EXPLORE` is a local Next.js link to `/track/[id]`; no source-site or provider
  detail URL may enter the UI.
- Play dispatches `LOAD_TRACK` with the current daily queue and `autoplay: true`
  when another Track is active. For the active Track it toggles play/pause.
  Entry animation never waits for source resolution, and closing preview never
  pauses or unloads the persistent player.
- Known `vip`, `copyright`, and `region` availability disables play and includes
  a textual reason. `unknown` remains actionable until the source request proves
  otherwise; it must not invent a specific restriction.
- Like is a disabled icon control labelled as not yet available. It performs no
  optimistic state change or external write.

## Data States

- Keep the daily Track visible while `/api/tracks/[id]` refreshes normalized
  details. Loading reserves metadata space and does not cover the shared artwork.
- A Track detail error retains the daily Track, shows an inline reason and retry,
  and does not auto-enter Demo mode.
- A stale Track detail response is ignored after target replacement or exit.
- Lyric summary failure is partial: Track metadata and controls remain usable and
  the summary shows a truthful unavailable line. T014 owns synchronized lyrics.

## Accessibility And Responsive Behaviour

- Preview is a labelled homepage region, not `aria-modal`; it preserves the app
  navigation and persistent player.
- Back, play, like, and counter controls have accessible names, visible focus,
  and at least 44x44px hit areas. Focus moves to the preview heading after entry
  begins and returns to the gallery Canvas or fallback region after exit.
- 1440, 768, and 390 widths must have no overlap or horizontal overflow. Player
  appearance reserves its existing bottom area without hiding preview controls.
- Long Track, artist, and album names wrap; they do not use viewport-scaled type
  or negative tracking.

## Verification

- Component: entry content, detail loading/success/error/retry, unavailable play,
  first-frame play, local Explore href, Escape/back/counter equivalence, and
  Reduced Motion semantics.
- E2E: first/middle/last shared mesh, entry timing bound, entry interruption,
  wheel consumption, Escape/back exit, rapid selection, playback persistence,
  local Explore navigation/back restoration, Canvas fallback, and 1440/768/390
  screenshots with nonblank stable Canvas pixels.
- Acceptance: `PREVIEW-AC-01..04` and
  `VIS-AC-05/07/08/10/21/23/28`.
