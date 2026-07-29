# FilmstripGallery Specification

## Overview

- Target: `src/components/FilmstripGallery.tsx`
- Screenshot: `docs/design-references/original-home-1440.png`
- Interaction model: wheel, pointer, click, resize, and time driven.

## Structure

- Full-viewport unframed Three.js canvas.
- Orthographic camera facing a horizontal row of project planes.
- One plane per project using local WebP textures.
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
