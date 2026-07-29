# AboutPanel Specification

## Overview

- Target: `src/components/AboutPanel.tsx`
- Screenshots: `docs/design-references/original-about-1440.png`, `original-about-390.png`
- Interaction model: route/click driven with entry and exit animation.

## Structure

- Full-viewport absolute layer.
- Two-row display code: `ESY68` / `33098L`.
- Biography paragraph.
- Social link column.
- Client and award columns on wide screens.
- Credit and rights blocks at the lower right.

## Styles

- background: `#141414`; color: `#bac4b8`
- Display code starts at 50px left and about 49px top.
- Display font: `TNY`; height-driven size from the source breakpoints.
- Biography: left 50px, about 7.5vh below the display block, 11px/10px.
- Social links: left 50px, bottom `calc(6.66667vh + 50px)`, 12px/14px.
- Clients: positioned from the right, 11px/11px; hidden below 1050px.
- Rights: right 50px, bottom 48px, 10px/10px, right aligned.

## Content

- Biography is verbatim from the target.
- Social links: Email, Instagram, Twitter, Behance, Dribbble, LinkedIn, GitHub.
- Client names and award totals come from the extracted `projects.json`/DOM research.

## Animation

- Display letters enter from left using clipped spans.
- Paragraph, social, client, and rights rows enter from below.
- Reverse the motion on close before disabling the layer.

## Responsive

- Mobile deliberately preserves oversized display type and horizontal clipping.
- Client/award columns disappear below 1050px.
- Biography may clip horizontally at 390px, matching the source.

