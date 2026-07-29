# ECHOFORM Foundation Components Specification

## Scope

- Target files: `src/app/globals.css`, `src/components/IconButton.tsx`,
  `src/components/TextButton.tsx`, `src/components/AlbumArtwork.tsx`,
  `src/components/StatusView.tsx`, `src/components/Skeleton.tsx`.
- This task establishes the shared design-system boundary only. It does not
  connect data fetching, playback, routing, theme extraction, or page-level
  network requests.
- `TrackRow` is intentionally deferred to its feature task; these components
  must not invent a second track-row contract.

## Token Contract

- Primitive values live only in `globals.css` under `--ef-color-*`,
  `--ef-space-*`, `--ef-radius-*`, `--ef-shadow-*`, type, motion, and z-index
  variables.
- Semantic variables map INK, PAPER, and ARTWORK through `data-theme` on the
  root element. ARTWORK starts from constrained runtime variables and falls
  back to INK values until the theme module exists.
- Component variables define stable dimensions, icon sizes, focus rings, and
  motion. Component CSS consumes semantic or component variables only.
- Existing Aristide aliases (`--canvas`, `--foreground`, and motion aliases)
  remain mapped through dedicated legacy primitives in the token layer so the
  reconstruction does not change during this foundation task.

## Component Contracts

### IconButton

- Native `button`; required `label` becomes the accessible name and native
  tooltip title unless an explicit tooltip is provided.
- Sizes: `sm` 36px for desktop-only low-frequency controls, `md` 44px, `lg`
  52px. Visual icons are 16/18/22px.
- `loading` disables the command, keeps the button box and icon slot stable,
  and exposes `aria-busy`.
- `pressed` maps to `aria-pressed`; focus uses a visible two-layer ring.
- Empty/error states are not command states; `StatusView` owns those messages.

### TextButton

- Native `button`; variants are `primary`, `secondary`, `quiet`, and `danger`.
- Desktop height is 40px and mobile height is 44px. The leading progress slot
  is reserved in every state so loading never changes width.
- `loading` disables the command and exposes `aria-busy`. Focus, pressed, and
  disabled states never move surrounding content.
- Text buttons are reserved for explicit commands such as retry, login,
  confirm, and view-all; media commands use `IconButton`.

### AlbumArtwork

- Renders a fixed-ratio media surface with variants `film-slice`, `thumbnail`,
  `tile`, `preview`, and `player`.
- Receives a normalized public image URL or `null`; it never fetches data or
  decides the page theme. `alt` is required for meaningful artwork.
- Statuses are `idle`, `loading`, `loaded`, `empty`, `error`, and
  `unavailable`. Loading/error/empty preserve the same aspect ratio; error
  uses a neutral record icon and text, unavailable retains the cover with a
  readable overlay.
- Optional `onClick` upgrades the surface to a native button; `disabled` and
  focus are then semantic and visible.

### StatusView

- Provides page and inline variants for `empty`, `error`, `unavailable`,
  `offline`, and `info` states.
- Anatomy is icon, one-line title, short description, one primary recovery
  action, and an optional secondary action. It never uses decorative artwork,
  Emoji, or color alone.
- Error uses `role="alert"`; other states use a polite status region. Actions
  use the shared `TextButton` contract and may be loading or disabled.

### Skeleton

- Provides fixed `line`, `line-short`, `block`, `artwork`, and `button` shapes.
- Geometry matches the eventual component slot and never uses a sweep-gradient.
- The breathing animation starts only after the local loading threshold and is
  at least 1200ms. Reduced Motion renders a static surface.
- Decorative skeletons are `aria-hidden`; an optional `label` exposes a single
  live loading status for screen readers.

## Acceptance Matrix

- Default, loading, empty, error, disabled, focus-visible, selected/playing,
  and reduced-motion behavior is represented by component tests where the
  state applies; non-applicable command states are documented above.
- No component contains a raw color value, an external data request, an Emoji,
  or a layout-shifting hover/pressed transform.
- All interactive boxes meet the 44px minimum where the design contract
  requires a touch target, and all image slots reserve dimensions.
