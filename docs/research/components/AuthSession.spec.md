# ECHOFORM Authentication and Session Specification

## Scope

- Owns the ECHOFORM `sid` cookie, server-only in-memory session lifecycle, QR
  challenge routes, client session state, the navigation account entry, and QR
  login dialog.
- Target files: `src/lib/session/**`, `src/lib/music/netease/**` auth-only
  adapter methods, `src/app/api/auth/**`, `src/features/auth/**`, and
  `src/components/FixedNavigation.*`.
- The browser consumes only normalized ECHOFORM session and QR state. Upstream
  cookie, QR key, QR payload, raw account response, and source URL never leave
  the server.

## Server Contract

### Session Store

- Create an opaque `sid` with `crypto.randomBytes(32)` and encode it as URL-safe
  base64 without padding. The resulting 256-bit random value is sent only in an
  `HttpOnly`, `SameSite=Lax`, `Path=/` cookie; `Secure` is enabled for HTTPS.
- Store each session in a process-local `Map`. A session starts in `real` mode,
  expires after 12 idle hours, and is removed when the development server
  restarts.
- The store owns the upstream cookie and current QR challenge. It exposes no
  method that serializes either value to a route response.
- Starting a new challenge supersedes and clears the previous challenge in the
  same session. Challenges expire after five minutes and carry an independent,
  opaque `challengeId` generated with the same CSPRNG requirement.
- On upstream `803`, retain the upstream cookie only in the session, clear the
  QR key immediately, then validate the login through the account-status
  endpoint. A missing normalized user is an auth failure, never a logged-in
  state.
- Logout attempts upstream logout when an upstream cookie exists, then always
  destroys the local session, including when upstream logout fails.

### Public Routes

All auth responses use the established `ApiSuccess` / `ApiFailure` envelope,
set `Cache-Control: no-store`, and include a request ID. The response body and
error details never include secret or private upstream values.

| Route | Success data | Notes |
| --- | --- | --- |
| `GET /api/auth/session` | `{ user: UserProfile | null, mode: "real" | "demo" }` | Creates an anonymous session when no valid `sid` exists and refreshes the cookie. |
| `POST /api/auth/qr` | `StartQrResponse` | Replaces an existing challenge and returns only the ECHOFORM challenge ID, QR image data URL, and deadline. |
| `GET /api/auth/qr/status?challengeId=...` | `QrStatusResponse` | Rejects a missing, superseded, foreign, or expired challenge with `QR_EXPIRED`. |
| `POST /api/auth/logout` | `{ user: null, mode: "real" }` | Local session is gone even if the upstream operation fails. |

`801` maps to `waiting`, `802` to `scanned`, `803` to `authorized`, and `800`
to `expired`. The fixed upstream version has only anonymous runtime evidence for
`801`; all four mappings are covered by offline sanitized tests but 802/803 are
not claimed as live-account evidence.

## Client State and Polling

- `AuthProvider` fetches `/api/auth/session` once after hydration. While this
  is pending, the account entry remains a stable 44px loading button.
- Guests open `QrLoginDialog` through the `BrandMark`; logged-in users see an
  `AvatarButton` at the same navigation location. Avatar activation is a local
  link to `/profile/[id]`.
- Opening the dialog starts one QR challenge. A second explicit refresh aborts
  the prior request, discards its image from component state, and replaces it.
- Polling starts only for `waiting` or `scanned`, runs at 2,000ms intervals
  while `document.visibilityState === "visible"`, and stops on close, Escape,
  expiry, network error, authorization, unmount, or page visibility loss.
- A visibility return performs one immediate status read only when the current
  challenge is still active and before its local deadline.
- On `authorized`, the client uses the returned normalized user, closes the
  dialog, and replaces the BrandMark within one second. It does not poll again.
- `800`, the local deadline, or `QR_EXPIRED` changes the dialog to expired and
  frees the QR image. A network error is inline and provides retry. Closing the
  dialog does not change the session state.
- Logout is available only from the avatar account menu. It clears client user
  state after the server response and restores the `BrandMark`; it never clears
  unrelated visual or player preferences.

## Component Contract

### BrandMark

- Native `button`, `aria-label="使用网易云音乐登录"`, `title` with the same
  text, 44px interaction box, and an ECHOFORM-owned line mark rather than a
  NetEase logo.
- The visible mark is 24px. It uses a short indicator during session loading;
  no perpetual decorative rotation.

### AvatarButton

- Native local link to `/profile/[id]`, with a 44px interaction box. The image
  is 32px on desktop and 36px on mobile, circular, and given descriptive alt
  text based on the normalized nickname.
- An image load error renders the first available nickname character in the
  same fixed avatar boundary. No fabricated user identity or random artwork is
  used.
- A compact account menu provides the explicit logout command. It is keyboard
  reachable and returns focus to the avatar after a dismissed menu.

### QrLoginDialog

- Native dialog semantics: `role="dialog"`, `aria-modal="true"`, label,
  visible close button, Escape closure, focus trapped while open, and focus
  restored to the triggering BrandMark when closed.
- Desktop opens from the upper-right account position using transform and
  opacity over `--ef-duration-qr` (480ms); the scrim dims the gallery and
  blocks background interaction. Reduced Motion uses a 150-220ms crossfade.
- A fixed 280px QR stage preserves the outer dialog dimensions across loading,
  waiting, scanned, success, expired, and error. QR images use `image-rendering:
  pixelated` and `object-fit: contain` to remain square and sharp.
- Copy is concise and state-specific: `使用网易云音乐扫码`, `请在手机上确认登录`,
  `登录成功`, `二维码已过期`, and `无法连接登录服务`.
- Refresh/retry uses `TextButton`; close uses the Lucide `X` icon via a labeled
  icon button. All controls are at least 44px.

## State Matrix

| State | Stable stage content | Polling | Recovery |
| --- | --- | --- | --- |
| Initial | Skeleton QR stage | no | automatic QR request |
| 801 waiting | QR image + scan instruction | every 2s when visible | close |
| 802 scanned | QR image + confirmation instruction | every 2s when visible | close |
| 803 authorized | brief success acknowledgement | stopped | auto-close after session update |
| 800/local expiry | expired instruction | stopped | refresh |
| Route/network error | inline error instruction | stopped | retry |

## Acceptance and Test Boundaries

- Unit tests cover random IDs, idle cleanup, challenge replacement, ownership,
  expiry, 803 cookie handling, session destruction, and no secret serialization.
- Contract tests cover each route's envelope, headers, cookies, error mapping,
  sanitized adapter inputs, and 800/801/802/803 mapping without QR payloads or
  raw account data in fixtures.
- Component tests cover loading, all QR states, retries, close, Escape, focus
  loop/restore, hidden-page polling pause, avatar fallback, and logout.
- E2E covers the local mocked auth flow at 1440px, 768px, and 390px, including
  fixed dialog bounds, keyboard behavior, responsive targets, session refresh,
  and an inline failure state. Live scan/confirmation needs a dedicated test
  account and is outside default test execution.
