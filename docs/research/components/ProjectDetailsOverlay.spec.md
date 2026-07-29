# ProjectDetailsOverlay Specification

## Overview

- Target: `src/components/ProjectDetailsOverlay.tsx`
- Screenshot: `docs/design-references/original-wheel-state-1440.png`
- Interaction model: project selection and click driven.

## Structure

- Project counter (`01 / 30`).
- Stylized project title.
- Four metadata rows: completed, type, role, client.
- Two-line description.
- `EXPLORE` link to the local original-path detail route.
- Close/back control that returns to the film.

## Styles

- Full-viewport pointer-events-none wrapper above the WebGL canvas.
- Interactive links re-enable pointer events.
- Utility text uses `jws`; large animated title uses `TNY`.
- Foreground is `#bac4b8`; backgrounds remain transparent.
- Text rows use clipped overflow and translate-based reveals.

## Behavior

- Remains mounted across `entering`, `visible`, and `exiting` phases so content
  never disappears before its exit motion finishes.
- The project number and total remain at the top center.
- `ABOUT` remains available at the upper right through `FixedNavigation`.
- Text and controls use the selected project's extracted accent color.
- Title letters reveal from clipped vertical wrappers over `1600ms` with a
  restrained stagger. Metadata and description start at `400ms`; `EXPLORE`
  starts at `600ms`.
- Exit starts all clipped elements together and completes in about `500ms`.
- Content is unmounted only after the exit phase completes.
- `EXPLORE` uses `/${project.slug}` and must not navigate to the source origin.
- Escape, wheel, and the counter start the same exit sequence.
- Reduced-motion uses short opacity/transform transitions while preserving order.

## Responsive

- Large metadata helpers hide under approximately 1350px.
- Primary title, counter, description, and Explore link remain available.
