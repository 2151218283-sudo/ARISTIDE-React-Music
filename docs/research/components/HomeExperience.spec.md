# HomeExperience Specification

## Overview

- Target: `src/components/HomeExperience.tsx`
- Owns homepage mode, selected project, History API state, and keyboard escape.

## State Machine

- `entry`: compact film begins at the right side and animates into place.
- `browse`: the stable homepage state centers the film across the viewport.
- `details-entering`: a browse-plane click centers that project and starts data reveals.
- `details-visible`: the selected project is stable and accepts exit input.
- `details-exiting`: film mode has returned to browse while project DOM completes
  its `500ms` clipped exit.
- `about`: `/about` replaces the gallery visually and disables film input.

The rendered project and the WebGL active project are separate state values.
During exit, the WebGL project clears immediately while the rendered project stays
mounted until the overlay animation completes.

## Navigation

- Opening About calls `history.pushState` with `/about`.
- Closing About calls `history.pushState` with `/`.
- `popstate` derives About state from `location.pathname`.
- Direct requests to `/about` render the same component with About initially open.

## Keyboard

- Escape closes About first when About is visible.
- Escape returns details through `details-exiting`.

## Wheel

- The first non-zero wheel event in either details phase starts exit and is consumed.
- Once WebGL returns to browse, later wheel events are allowed to move the track.
