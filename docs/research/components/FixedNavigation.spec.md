# FixedNavigation Specification

> Status: original-site reconstruction research record. T005 replaced the
> runtime component contract with `AppShellNavigation.spec.md`; the dimensions
> below remain evidence for the pre-ECHOFORM navigation only.

## Overview

- Historical target: the pre-T005 `src/components/FixedNavigation.tsx`
- Screenshot: `docs/design-references/original-home-1440.png`
- Interaction model: click and hover driven.

## DOM Structure

- `nav`
- Brand link composed from individually clipped letters.
- Mode switch containing `ABOUT` and `CLOSE` in one clipped line.
- Two-line availability mail link.
- Three right-aligned social links.

## Computed Styles

### Brand

- position: absolute; top: 35px; left: 38px
- font: 400 50px/44px `TNY`
- letter-spacing: -1px
- color: `#bac4b8`

### Mode Switch

- position: absolute; top: 40px; right: 50px
- font: 12px/34px `jws`
- letter-spacing: -0.24px
- active row transform: `translateY(0)`
- inactive row transform: approximately `translateY(-110%)`

### Availability

- position: absolute; left: 50px; bottom: 48px
- width: 129.3125px; height: 20px
- font-size: 10px; line-height: 10px

### Social Links

- position: absolute; right: 50px; bottom: 47px
- width: 89.4271px; height: 42px
- text-align: right; font-size: 12px; line-height: 14px

## States

- Load: letters move from `translateX(-110%)` and links from `translateY(101%)`.
- Home: About accepts pointer input; Close is translated out and disabled.
- About: Close accepts pointer input; About translates out and is disabled.
- Hover: foreground lightens slightly; arrow opacity rises over 400ms.

## Responsive

- The four 38/50px offsets remain unchanged at 1440, 768, and 390 widths.
- Text sizes remain fixed, not viewport-scaled.
