# Behaviors

## Interaction Model

The homepage is wheel-, pointer-, click-, resize-, and time-driven. The document itself does not scroll; all motion is internal to a fixed viewport application.

## Loading

- Logo letters enter horizontally from `translateX(-110%)`.
- Navigation links enter vertically from `translateY(101%)`.
- Film planes and progress ticks fade/translate into place after assets load.
- The original needs roughly 4.5 seconds to reach a fully settled first frame in the inspection browser.

## Wheel

- Vertical wheel delta drives horizontal film movement.
- Movement uses inertial interpolation; it continues briefly after wheel input ends.
- The thirty projects occupy a finite track. The first and last projects form the
  start and end boundaries and are centered in the viewport at their limits.
- Outward wheel input at either boundary is discarded, does not accumulate, and
  does not delay the next inward movement.
- Actual track velocity produces a restrained wave through vertical scale,
  vertical displacement, and z rotation. The wave settles after movement and is
  suppressed while the track is locked at a boundary.
- Progress ticks and project index follow the clamped track position.

## Pointer

- Pointer position adds a restrained parallax offset to the gallery.
- Hovering a film plane raises its luminance and opacity.
- Moving away restores the dim monochrome state with an eased transition.

## Project Selection

- Clicking a film plane selects a project without immediately navigating.
- The selected plane expands to the `1054 x 602` ratio-adjusted central frame.
- Immediate neighbors become half-width frames while distant projects retain
  narrow film widths. The finite order is preserved without wrapping the ends.
- Title letters begin their clipped reveal immediately. Project information starts
  after about `400ms`; `EXPLORE` starts after about `600ms`.
- The complete entry motion lasts `1600ms` and remains interruptible.
- The corresponding project data remains mounted through both entry and exit.

## Project Exit

- Any non-zero wheel event while project details are active begins exit. Wheel
  direction and magnitude do not change the decision and no threshold is accumulated.
- The first wheel event changes mode and is not applied to film position. Later
  events in the same wheel gesture drive the restored finite film track.
- Title, metadata, description, counter, and `EXPLORE` use clipped `500ms` exits.
- The selected plane simultaneously contracts into its original film position;
  subsequent wheel velocity restores the wave and gives the exit spatial continuity.
- Escape and the project counter use the same exit sequence.

## Project Detail Routes

- `EXPLORE` uses the original relative `/<slug>` route on the local origin.
- A direct load of a valid project route renders the same local work viewer.
- `PROJECTS` returns to the local homepage; the project client's `VISIT SITE`
  remains an external link when one is available.
- All route media is stored under `public/assets/work/<slug>/`.

## About

- Clicking `ABOUT` sets the URL to `/about` using History API behavior.
- `ABOUT` translates out while `CLOSE` translates in.
- The gallery becomes non-interactive and the About content animates into view.
- Clicking `CLOSE` returns to `/` and restores gallery interaction.

## Hover Links

- Text link color transitions use `500ms cubic-bezier(.25,.46,.45,.94)`.
- Social and availability links reveal a directional arrow with a short opacity transition.
- Link underlines are drawn as independent one-pixel lines rather than text decoration.

## Responsive Rules

- At `max-width: 1150px`, the original DOM thumbnail hit column is hidden.
- At `max-width: 700px`, the original 2D HUD canvas is hidden.
- At `max-width: 1050px`, About client/award columns are hidden.
- At `max-height: 700px`, the biography is hidden.
- At `max-height: 850px`, some About social rows are hidden.
