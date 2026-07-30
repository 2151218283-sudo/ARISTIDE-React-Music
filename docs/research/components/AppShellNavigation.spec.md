# ECHOFORM AppShell and Navigation Specification

## Scope

- Target files: `src/app/layout.tsx`, `src/app/globals.css`,
  `src/components/AppShell.tsx`, `src/components/FixedNavigation.tsx`,
  `src/components/RoutePlaceholder.tsx`, and the T005 route pages.
- This task owns document metadata, page language, route-level shell selection,
  primary navigation, skip navigation, focus entry, and honest static route
  placeholders.
- This task does not mount `PlayerProvider`, create an `Audio` instance, fetch
  music data, implement QR login, or claim that later product features work.

## Route and Shell Contract

| Route | Shell variant | Scroll model |
| --- | --- | --- |
| `/`, `/about` | `immersive-fixed` | Viewport-locked legacy gallery scene |
| `/track/[id]` | `player-immersive` | Viewport-sized immersive placeholder |
| `/search`, `/album/[id]`, `/artist/[id]`, `/library`, `/playlist/[id]`, `/profile/[id]`, `/settings` | `content-scroll` | Standard document scrolling |

- Known ECHOFORM routes receive exactly one root `AppShell` and one primary
  navigation.
- Existing root-level `/<slug>` project pages are legacy reconstruction routes.
  They render unchanged without the ECHOFORM shell so their own navigation,
  main landmark, transition, and layout remain intact.
- Unknown routes remain owned by Next.js and are not classified as product
  pages by matching every first path segment.
- `PlayerProvider` and the persistent player region stay absent until T007.

## AppShell Contract

- The root shell provides a visually hidden skip link as its first focusable
  control and one `main` landmark with `id="main-content"`.
- On a client route change, focus moves to the destination `h1` when present;
  otherwise it moves to the main landmark. Initial hydration must not steal
  focus before a user navigates.
- `immersive-fixed` and `player-immersive` lock their own viewport region.
  `content-scroll` uses normal document flow, reserves navigation safe areas,
  and permits vertical scrolling without horizontal overflow.
- Shell layers use the token z-index scale: content below navigation, future
  player below drawers, and the skip link above all current shell content.
- Safe-area insets are included for the mobile top and bottom navigation.

## Navigation Contract

### Desktop and tablet

- Left: local `ECHOFORM` brand link to `/`.
- Center: a non-interactive route context such as `DAILY SIGNAL`, `SEARCH`, or
  `NOW PLAYING`.
- Right: Search icon link and the account entry. Guests receive the ECHOFORM
  `BrandMark` button that opens QR login; authenticated users receive a local
  avatar link to `/profile/[id]` plus an adjacent account-menu control.
- Search is always one interaction from every ECHOFORM route.

### Mobile

- Top: `ECHOFORM` brand, Search icon link, and account placeholder.
- The route context is hidden when it cannot fit without crowding the actions.
- There is no persistent bottom navigation. The homepage already owns discovery,
  while Library remains a secondary destination from Profile or the account menu.
- Interactive targets are at least 44px in both dimensions with at least 8px
  separation.

### Shared states

- Every destination is local. No original-site URL, mail link, or social link
  belongs to the ECHOFORM navigation.
- The brand and Search destinations expose `aria-current="page"` when they own
  the current route. The guest account entry is an action rather than a route;
  the logged-in avatar is current only on its own `/profile/[id]` route. Context
  text is never interactive.
- Icon-only controls have Chinese accessible names and native tooltips.
- The guest `BrandMark` opens only the real same-origin QR login dialog. It
  never imitates a successful login or links to an external music website. The
  logged-in account menu provides a local settings route and an explicit logout
  action; the avatar itself links to the local user profile.
- Focus-visible rings use shared semantic tokens. Reduced Motion removes
  navigation reveal and focus-entry scrolling without removing state changes.
- The `ECHOFORM` wordmark uses the normal-width body typeface at a strong weight,
  with `letter-spacing: 0` and no scale transform; the legacy `TNY` display face
  is prohibited for the product brand.

## Route Placeholder Contract

- Every new T005 route renders a local page title and the shared `StatusView`
  with `status="info"` to state that the module is under construction.
- Dynamic route identifiers may be displayed only as inert local context; they
  are never treated as fetched entity data.
- The placeholder exposes no disabled fake player, QR code, fabricated music,
  retry command, or external deep link.
- Loading, empty, and API-error states are not applicable in T005 because these
  shells perform no asynchronous request. Their later page tasks must add those
  states when data fetching is introduced.

## Accessibility and Responsive Acceptance

- Keyboard users can reach the skip link, enter the main heading, traverse all
  visible navigation destinations, and return to `/`.
- The shell supports browser zoom to 200%; viewport metadata must not disable
  scaling.
- At 1440px, 768px, and 390px widths, navigation does not overlap page titles,
  create horizontal scrolling, or cover the main placeholder status.
- Mobile actions include safe-area padding. Content reserves only the future
  persistent player height and never an absent bottom navigation bar.
- `prefers-reduced-motion: reduce` keeps the structure and focus behavior usable
  without decorative transitions.
- The existing home Canvas remains nonblank at all three viewports, and its
  bounded gallery, wave deformation, entry sequence, and wheel-to-exit preview
  behavior remain unchanged.
