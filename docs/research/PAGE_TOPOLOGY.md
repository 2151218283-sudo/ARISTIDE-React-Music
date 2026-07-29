# Page Topology

## Scope

- Target: `https://aristidebenoist.com/`
- Local scope: homepage, About state, gallery motion, project selection overlay, and all homepage links.
- Project-detail pages use the original same-origin `/<slug>` paths and render
  locally from the approved source assets.

## Layer Order

1. `HomeExperience`: fixed, viewport-sized application shell with `overflow: hidden`.
2. `FilmstripGallery`: full-bleed WebGL scene on the lowest canvas.
3. `GalleryHud`: transparent full-viewport 2D canvas for progress ticks and fine lines; hidden below 700px.
4. `ProjectDetailsOverlay`: DOM information for the selected project, above the canvases.
5. `ProjectWorkExperience`: local project-detail media viewer opened by `EXPLORE`.
5. `AboutPanel`: full-viewport DOM layer using the same background and foreground colors.
6. `FixedNavigation`: logo, About/Close switch, availability, and social links.

## Homepage State

- Background is a flat `#141414` field.
- The project film begins right of center and extends beyond the right viewport edge.
- Project images are monochrome, dimmed, and clipped into tall narrow planes.
- Thirty fine progress ticks sit near the upper center/right.
- Fixed navigation occupies all four corners without a visible container.

## About State

- URL becomes `/about` without a document reload.
- Gallery remains mounted but the About layer visually replaces it.
- Large `TNY` display text reads `ESY68` and `33098L` in two rows.
- Biography, social links, clients, awards, credits, and rights are positioned independently.
- At narrow widths, the oversized display text and biography intentionally clip horizontally.

## Responsive Topology

- Desktop 1440x900: full navigation, HUD canvas, gallery, About client/award columns.
- Tablet 768x1024: gallery planes shrink and move toward the right edge; secondary About columns collapse.
- Mobile 390x844: HUD canvas is hidden, gallery shows approximately three narrow planes, fixed corner navigation remains.
