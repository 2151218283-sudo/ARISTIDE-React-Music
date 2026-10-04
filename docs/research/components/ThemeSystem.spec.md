# T024 Theme System Specification

> Status: implementation contract
> Scope: INK, PAPER, and ARTWORK on the application shell and immersive music routes

## Ownership and state

- `src/lib/theme/` owns pure color math, pixel sampling, contrast checks, and
  browser image extraction. It never reads a music account or writes a server
  session.
- `ThemeProvider` is mounted once inside AuthProvider and PlayerProvider. It
  owns the local `echoform:theme-preference` value and applies semantic tokens
  to the root element. Only `ink`, `paper`, or `artwork` are valid stored values.
- The saved preference and effective theme are distinct. A guest, Demo session,
  loading/failed session, or failed immersive page read uses INK. The saved
  preference survives logout and Demo mode but is not applied until a Real
  authenticated session is available. PAPER is never selected by a route.
- A Real authenticated user defaults to ARTWORK when no valid local preference
  exists. The selected gallery track, open preview track, and loaded track page
  supply their normalized artwork URL. Other routes retain the last resolved
  ARTWORK palette while the provider is mounted; a fresh route without artwork
  starts at INK. No artwork URL or sampled pixel data enters localStorage.
- The global navigation exposes an icon-triggered three-option segmented theme
  selector. Unavailable non-INK choices are visibly disabled for guest/Demo.
  Selection has a pressed/checked state, keyboard access, Escape dismissal,
  focus return, and a stable 44px trigger. Selecting an option closes the
  selector and returns focus to its trigger.

## Extraction and contrast

- Load only the selected cover, with anonymous CORS and a bounded deadline.
  Draw it into a 32x32 offscreen canvas and read only that reduced image. Never
  read the full-size bitmap or block playback controls.
- Ignore transparent pixels and low-frequency near-black/near-white outliers.
  Derive a dominant chromatic family and a secondary color from the remaining
  pixels; a neutral image may resolve to a restrained neutral palette.
- Reduce saturation and clamp lightness before using artwork as a surface.
  Derive canvas, raised, overlay, primary/secondary accent, primary/muted text,
  action text, and focus tokens together. Check ordinary text against all
  surfaces at >= 4.5:1 and accent/focus against the canvas and overlay at
  >= 3:1. If a candidate cannot pass, use the neutral INK palette.
- The runtime applies all ARTWORK CSS variables before changing `data-theme`.
  When a new track is selected, keep the old palette until the new one is ready.
  An obsolete image result cannot replace a newer track's palette. Missing,
  timed-out, tainted, or failed images resolve to INK with no blank frame.
- A failed immersive page read forces INK even when PAPER was saved. Loading a
  replacement track retains the current theme; failure resolves to INK.
- The opaque WebGL gallery reads the same resolved canvas token as the document.
  It interpolates its clear color for the theme duration, wakes its existing
  render loop only while the color is moving, and changes instantly under
  Reduced Motion. Its HUD uses the active foreground token.
- Use flat color transitions for canvas, foreground, and controls. Under
  Reduced Motion they become effectively instant. No fixed gradient or
  decorative color wash is introduced.

## Acceptance

- Unit tests use synthetic pixel arrays for vivid, dark, bright, neutral,
  transparent, and mixed covers; every emitted palette passes contrast checks.
- Component tests cover saved preference, anonymous/Demo restrictions, manual
  INK/PAPER/ARTWORK, auth changes, rapid target replacement, image failure, and
  keyboard/focus behavior. No test fetches real provider artwork.
- Local Playwright tests check home, preview, and track page at 1440x900,
  768x1024, and 390x844; confirm color changes, stable dimensions, no
  horizontal overflow, a nonblank gallery canvas, Reduced Motion, and no
  theme flash on image failure.
- `npm run test`, `npm run check`, sensitive-data review, and
  `git diff --check` pass before T024 is marked complete. T025 remains separate.
