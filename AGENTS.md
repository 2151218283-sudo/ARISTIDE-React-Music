# Aristide Benoist Clone Rules

## Scope

These rules apply to this standalone reconstruction of `https://aristidebenoist.com/`.
The implementation scope includes the root homepage, every interaction available
from that page, and same-origin project-detail routes opened through `EXPLORE`.
External client sites remain external links.

## Structure

- `src/app/`: Next.js App Router entry points and global styles.
- `src/components/`: React UI components; one primary component per file.
- `src/lib/webgl/`: Three.js scene, shaders, animation, and interaction logic.
- `src/types/`: shared TypeScript interfaces.
- `public/assets/`: locally stored fonts, images, SVGs, and favicons from the approved target.
- `public/assets/work/`: locally stored project-detail media, grouped by project slug.
- `docs/research/`: page topology, behavior findings, design tokens, and component specifications.
- `docs/design-references/`: original and local screenshots used for visual comparison.
- `scripts/`: bounded asset and visual verification scripts.

## Implementation

- Use Next.js 16, React 19, strict TypeScript, Tailwind CSS 4, and Three.js.
- Keep all runtime assets local. Do not hotlink target-site images, fonts, or icons.
- Match measured values from the target. Do not replace extracted values with approximate utility presets.
- Write or update a component specification before implementing that component.
- Preserve the target's wheel, pointer, hover, click, resize, and timed behaviors.
- Preserve same-origin target routes locally. Do not replace an original relative
  project route with an absolute link back to the source site.
- Use named exports, PascalCase components, camelCase utilities, 2-space indentation, and no `any`.
- Avoid inline styles except for runtime values that must be updated per animation frame.

## Verification

- `npm run lint`: ESLint.
- `npm run typecheck`: strict TypeScript check.
- `npm run build`: production build.
- `npm run check`: lint, typecheck, and build.
- Run visual checks at 1440px desktop, 768px tablet, and 390px mobile widths.
- Confirm each WebGL canvas has nonblank pixels and stable dimensions before completion.

## Safety

- Do not add secrets or environment files.
- Preserve unrelated workspace changes.
- Ask before deleting files or directories, changing Git history, pushing, publishing, installing global dependencies, or changing system configuration.
