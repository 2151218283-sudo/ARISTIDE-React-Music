# Design Tokens

## Colors

- Canvas background: `#141414` (sampled from the stable reference image).
- Primary foreground: `rgb(186, 196, 184)` / `#bac4b8`.
- Film images: grayscale with reduced brightness and opacity; active state approaches full luminance.
- Fine ticks: foreground at approximately 18% opacity.

## Typography

- Display: `TNY`, local file `public/assets/fonts/t.woff2`, weight 400.
- Utility/body: `jws`, local file `public/assets/fonts/jw.woff2`, source declares weight 700.
- Logo: 50px size, 44px line height, `-1px` letter spacing.
- Navigation link: 12px size, 34px line height, `-0.24px` letter spacing.
- Availability: 10px size, 10px line height.
- Social links: 12px size, 14px line height.

## Fixed Spacing

- Logo: top 35px, left 38px.
- About/Close: top 40px, right 50px.
- Availability: left 50px, bottom 48px.
- Social links: right 50px, bottom 47px.
- Projects marker: horizontally centered, top 49px.
- Visit marker: horizontally centered, bottom 44px.

## Motion

- Standard color easing: `500ms cubic-bezier(.25,.46,.45,.94)`.
- Image reveal easing: `1000ms cubic-bezier(.39,.575,.565,1)`.
- Gallery wheel damping target: approximately 0.08 per frame at 60fps.

