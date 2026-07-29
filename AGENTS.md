# ECHOFORM Music Player Rules

## Scope

These rules apply to the ECHOFORM immersive online music player. The existing
Aristide Benoist reconstruction is an approved interaction baseline for the
finite gallery, wave motion, shared artwork transition, and natural exit. It is
not the product information architecture or a continuing requirement to copy
the source site's content and routes.

The current product sources of truth are:

1. `docs/research/ECHOFORM_PRD_DRAFT.md` for product scope and release priority.
2. `docs/research/ECHOFORM_VISUAL_DESIGN.md` for visual and interaction rules.
3. `docs/research/TECHNICAL_ARCHITECTURE.md` for runtime boundaries, ownership,
   security, persistence, and deployment constraints.
4. `docs/research/NETEASE_API_CONTRACT.md` for pinned upstream facts, normalized
   data contracts, and verification status.
5. `docs/research/PLAYER_STATE_MACHINE.md` for playback, queue, recovery, and
   audio lifecycle behavior.
6. Feature-specific component and behavior specs for their owned UI surface.

`AGENTS.md` controls workspace discipline. The PRD controls product intent and
scope, the visual design controls presentation, the technical architecture
controls runtime boundaries, the API contract controls upstream facts, and the
player state machine controls audio behavior. When two sources disagree, do not
silently choose one. Record the conflict and stop implementation of that affected
behavior until the controlling documents are aligned.

## Structure

- `src/app/`: Next.js App Router pages, layouts, Route Handlers, and global styles.
- `src/app/api/`: same-origin BFF endpoints. Browser code must not call the
  upstream music API directly.
- `src/components/`: shared presentational and experience components; one
  primary component per file.
- `src/features/`: feature-owned UI and client state grouped by `auth`, `player`,
  `discovery`, `search`, `library`, and `profile`. Do not create a feature folder
  until its first specification exists.
- `src/lib/music/`: `MusicProvider` contract, normalized models, upstream
  adapters, error mapping, and server-only request helpers.
- `src/lib/player/`: audio controller, queue logic, playback state machine, and
  lyric synchronization utilities that are independent from page components.
- `src/lib/session/`: server-only session interfaces and implementations. This
  directory must never be imported by Client Components.
- `src/lib/theme/`: artwork color extraction, contrast calculation, and theme
  resolution.
- `src/lib/webgl/`: Three.js scenes, shaders, animation, and interaction logic.
- `src/types/`: shared application types that are not owned by a single feature.
- `src/data/demo/`: clearly labeled, deterministic graduation-demo fixtures and
  references to authorized local audio.
- `public/assets/`: local brand fonts, icons, approved demo media, and preserved
  reconstruction assets. Keep source-site assets separate from ECHOFORM assets.
- `public/assets/work/`: preserved legacy project-detail media; do not add new
  music-product data here.
- `docs/research/`: product, visual, architecture, API contract, state-machine,
  behavior research, and component specifications.
- `docs/design-references/`: original and local screenshots used for visual comparison.
- `scripts/`: bounded contract, fixture, asset, and visual verification scripts.
- `tests/contract/`: upstream adapter and normalized contract tests once the test
  runner is introduced.
- `tests/e2e/`: browser-level critical-path tests once Playwright is introduced.

Before creating any other top-level or `src/` directory, document its ownership,
contents, naming convention, and cleanup rule here.

## Implementation

- Use Next.js 16, React 19, strict TypeScript, Tailwind CSS 4, and Three.js.
- Keep brand assets, fonts, icons, demo media, and preserved reconstruction assets
  local. Do not hotlink assets from the Aristide source site.
- Dynamic artwork and playable audio may come only from the configured music
  provider through approved BFF contracts. Do not place user-specific media URLs
  in source files, fixtures, logs, or commits.
- Keep upstream field names and response shapes inside `src/lib/music/`. Pages,
  components, and player code consume normalized application models only.
- Keep upstream credentials and cookies server-side. Client Components receive
  only normalized data and a same-origin session state.
- Write or update a component specification before implementing that component.
- Preserve the measured finite gallery, boundary, wave, shared-artwork, and exit
  behaviors unless an ECHOFORM specification explicitly replaces them.
- Replace legacy portfolio routes with the local music routes defined by the PRD;
  product navigation must never return users to the source portfolio.
- Implement external write operations only after the relevant API contract is
  marked verified for the pinned upstream revision.
- Demo mode must be explicit in UI and application state. It must not silently
  make a failed real-provider acceptance test pass.
- Use named exports, PascalCase components, camelCase utilities, 2-space indentation, and no `any`.
- Avoid inline styles except for runtime theme variables and values that must be
  updated per animation frame.

## Verification

- `npm run lint`: ESLint.
- `npm run typecheck`: strict TypeScript check.
- `npm run build`: production build.
- `npm run check`: lint, typecheck, and build.
- Add and document unit, contract, and E2E commands before those test suites are
  introduced; do not claim they passed while only `npm run check` exists.
- Run visual checks at 1440px desktop, 768px tablet, and 390px mobile widths.
- Confirm each WebGL canvas has nonblank pixels and stable dimensions before completion.
- Verify real-provider and demo-mode critical paths separately.
- Contract fixtures must contain sanitized, non-user-specific data.

## Safety

- Do not add secrets, upstream cookies, tokens, private QR payloads, or environment files.
- Do not log raw upstream requests or responses that can contain account data.
- Treat changes to session persistence, databases, `.env`, deployment, CI/CD, or
  public hosting as approval-gated architecture changes.
- Preserve unrelated workspace changes.
- Ask before deleting files or directories, changing Git history, pushing, publishing, installing global dependencies, or changing system configuration.
