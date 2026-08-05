# Audio Relay Specification

> Status: T017B approved implementation scope
> Scope: same-origin, session-bound relay for an already authorized short-lived
> Netease playback source. This is transport adaptation for local development,
> not a source unlock, catalogue mirror, CDN, or deployment feature.

## Ownership

- `src/lib/music/netease/` obtains and normalizes an upstream source only on the
  server. Its URL may use HTTP or HTTPS and never reaches a client response.
- `src/lib/session/sessionStore.ts` holds the source URL in memory, bound to the
  ECHOFORM session, track, selected quality, and upstream expiry. It is cleared
  on expiry, logout, mode change, session expiration, and process restart. The
  process-local Store is shared through the server global so independently
  evaluated local Route Handler bundles address the same registration.
- `src/lib/music/audioRelay*.server.ts` owns source publication, permitted-host
  validation, Range forwarding, redirect validation, upstream timeout mapping,
  and response-header allowlisting.
- `src/app/api/tracks/[id]/source/route.ts` publishes a same-origin relay URL.
  `src/app/api/tracks/[id]/audio/route.ts` streams that registered source.
- `PersistentAudioHost` remains the only browser owner of `HTMLAudioElement`.
  It consumes the returned same-origin URL without receiving an upstream URL.

## Contract

`GET /api/tracks/:id/source?quality=...` preserves the existing JSON envelope,
`no-store` policy, quality validation, expiry field, and normalized error codes.
On success, `data.url` is exactly `/api/tracks/:id/audio`; it is not a redirect
and never embeds an upstream URL, Cookie, proxy address, or capability token.
The route creates the ordinary HttpOnly ECHOFORM `sid` only when necessary.

`GET /api/tracks/:id/audio` accepts a session-bound, already published source.
It forwards at most one valid `Range` header to an allowlisted upstream media
host and returns only these upstream response headers when present:
`Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`, and
`Last-Modified`. Every result is `Cache-Control: no-store`; upstream cookies,
locations, source URLs, and arbitrary headers are never forwarded.

The relay accepts only HTTP(S) media hosts in the fixed Netease CDN allowlist.
It follows at most three redirects, validating every target before opening it.
An absent, expired, or session-mismatched registration maps to
`SOURCE_EXPIRED`; an invalid Range maps to `VALIDATION_ERROR`; upstream media
access, timeout, or malformed media response maps to a normalized BFF error.

## Non-goals and invariants

- It never changes an upstream access decision. Empty URLs, VIP, copyright,
  region, and upstream denials remain unavailable.
- It never downloads an entire source before responding, writes audio to disk,
  persists an audio URL, transcodes content, or provides a public proxy URL.
- It uses `NETEASE_UPSTREAM_PROXY` only through the existing validated loopback
  configuration. There is no client proxy configuration or fallback guessing.
- It does not alter queue, source-refresh, autoplay, lyric, or mode semantics.
  A relay failure is a normal media/source failure handled by the existing
  one-refresh state-machine rule.
- It is approved only for the local, single-instance graduation demonstration.
  Production hosting requires a separate architecture review.

## Verification Matrix

| Case | Expected result |
| --- | --- |
| Published HTTP source with `Range` | Same-origin `206`, preserved range headers, no source URL in response |
| Published HTTPS source | Same-origin stream through the same allowlist and timeout policy |
| Missing, expired, or another-session source | `SOURCE_EXPIRED`, `no-store`, no upstream request |
| Invalid/multi-range request | `VALIDATION_ERROR`, no upstream request |
| Redirect to permitted host | At most three validated hops |
| Redirect to an unpermitted host | Safe upstream failure, no redirect forwarded |
| Upstream 403/404, timeout, or network failure | Normalized error, no source URL, Cookie, or proxy detail |
| Player source refresh | Replaces only the matching session registration; one Audio element and existing revision guards remain intact |

Contract tests use fake streams and injected request functions. They never save
or print upstream URLs, proxy addresses, cookies, QR values, or audio bytes.
