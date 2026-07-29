# ProjectWorkExperience Specification

## Overview

- Targets: `src/app/[slug]/page.tsx` and `src/components/ProjectWorkExperience.tsx`.
- Uses the original same-origin `/<slug>` route for every project in `projects.json`.
- Invalid slugs return the Next.js not-found response.

## Structure

- Fixed-viewport project presentation using the selected project's accent colors.
- Oversized project title at the left edge.
- Central active media frame with stable aspect ratio.
- Vertical thumbnail rail at the right edge.
- `PROJECTS` returns to `/`; `VISIT SITE` may open the approved external client URL.
- Existing fixed brand, About, availability, and social navigation remains visible.

## Interaction

- Wheel, Arrow Up/Down, Arrow Left/Right, and Space change the active media item.
- Media changes use directional transform interpolation and remain interruptible.
- Selecting a thumbnail updates the central frame without document scrolling.
- Browser back returns to the homepage using the standard history stack.

## Assets

- Project route metadata includes local media paths and optional external client URL.
- Runtime media must live under `public/assets/work/<slug>/` and must not hotlink.
- Images declare stable dimensions; videos use poster frames and preload metadata only.

## Responsive

- Desktop preserves the central-frame and thumbnail-rail composition.
- Tablet reduces the title scale and media frame while keeping the rail visible.
- Mobile replaces the rail with a compact bottom selector and keeps all controls
  at least `44px` in interactive size.
- `prefers-reduced-motion` removes large directional travel while preserving state clarity.
