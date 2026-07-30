# FilmstripGallery Specification

## Overview

- Target: `src/components/FilmstripGallery.tsx` and `src/lib/webgl/filmstripScene.ts`
- Screenshot: `docs/design-references/original-home-1440.png`
- Interaction model: wheel, pointer, click, resize, and time driven.

## Structure

- Full-viewport unframed Three.js canvas consuming normalized `Track[]` only.
- Orthographic camera facing a finite horizontal row of Track planes.
- One plane per Track. Square artwork uses shader cover-crop, never stretching.
- Missing or failed artwork uses an in-memory square Track texture; it must not
  use source-site work images or raw upstream records.
- Loading, empty/error, and Canvas initialization failure have a same-bounds
  DOM fallback. With Tracks, that fallback exposes labelled Track controls.
- Transparent 2D HUD canvas for progress ticks.

## Appearance

- Canvas bounds: inset 0, width/height 100vw/100vh.
- Background: `#141414`.
- Entry begins from the compact right-side origin and eases into the centered
  browser, with the first project centered in the viewport and the remaining
  projects continuing to the right.
- Desktop plane: about 7.8vw wide and 46.3vh tall, with 1.6vw gaps.
- Mobile plane: about 35px wide and 165px tall, with 7px gaps.
- Textures use grayscale; inactive brightness approximately 0.55.
- Planes use hard rectangular clipping with no radius or border.

## Wheel State

- Accumulate wheel delta into a target x offset.
- Clamp a single event contribution, then interpolate current position toward target.
- The sequence is finite: the first project is centered at the start boundary and
  the thirtieth project is centered at the end boundary.
- Clamp both current and target offsets to the finite track. Discard outward wheel
  input at either boundary so it cannot queue motion for the reverse direction.
- Drive the film wave from actual frame-to-frame track velocity, not raw wheel
  input. Outward input at a locked boundary therefore produces no deformation.
- While the track is moving, apply a low-frequency wave with restrained vertical
  scale, vertical displacement, and z rotation. Ease all planes back to their
  level resting state after movement stops.
- Do not change document scroll position.

## Pointer State

- Normalize pointer into `[-1, 1]`.
- Apply small x/y scene offsets and subtle plane depth variation.
- Hit-test planes with a Three.js raycaster.
- Hovered plane approaches brightness 0.9; others remain dim.

## Click State

- The centered project browser is the stable homepage state after entry.
- Clicking a plane sets the active project index.
- The active plane moves to the ratio-adjusted `1054 x 602` central frame.
- Its immediate neighbors become half-width frames at a `152px` ratio-adjusted
  gap; distant projects retain the overview width and finite ordering.
- Project detail layout must never wrap the first and last indices together.
- Details are emitted to `ProjectDetailsOverlay`.
- The first wheel event in details requests a return without moving the film.
  Subsequent events during contraction may move the restored track and drive its wave.
- Escape returns through the same contraction. The compact
  right-side strip is an entry-animation origin, not a persistent home mode.

## HUD

- Thirty short vertical ticks centered above the filmstrip.
- During entry, the ticks move from the compact strip's right-side position to
  the viewport center while scaling from 13px gaps / 23px height to roughly
  8.7px gaps / 15px height and moving from 72px to 49px from the top.
- Tick color is `#bac4b8` at low opacity.
- Hide HUD canvas below 700px.

## Responsive

- 1440x900: four or more planes visible from the right-side origin.
- 768x1024: three planes visible, scaled down and moved lower.
- 390x844: about three narrow planes visible and clipped by the right edge.

## T012 Track Migration Override

- This section supersedes the earlier Project-specific language for the T012
  implementation. `FilmstripGallery` and `FilmstripScene` receive normalized
  `Track[]`; no legacy Project or upstream response shape crosses the boundary.
- The sequence is finite: the first Track is centered at the start boundary and
  the last Track is centered at the end boundary. Boundary input is discarded
  and cannot create a wave or delayed reverse movement.
- Clicking a plane or a labelled fallback control updates the current Track and
  lower-left metadata. T012 does not open `ProjectDetailsOverlay` or navigate;
  Track preview expansion and local `/track/[id]` navigation are T013 work.
- Missing or failed artwork uses an in-memory square Track texture. Canvas
  initialization failure exposes `data-renderer="fallback"`; with Tracks it
  renders a labelled, finite DOM Track list. Data empty/error states retain
  truthful status controls rather than pretending that a Track exists.
- Verify loading, public/personal/Demo Tracks, empty data, provider error,
  missing artwork, texture error, Canvas initialization failure, first/middle/
  last positions, wheel, pointer, keyboard and touch fallback at 1440, 768,
  and 390 widths. Normal Canvas checks require nonblank pixels and disposal on
  unmount.
