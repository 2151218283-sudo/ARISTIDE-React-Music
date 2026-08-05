# BFF Public Read Routes Specification

> Status: T017A implementation baseline
> Scope: anonymous same-origin reads for search, tracks, playback sources, lyrics, and comments.

## Ownership

`src/app/api/` owns the thin Next.js Route Handler entrypoints. `src/lib/music/bff.ts`
owns request parsing, timeout and retry policy, HTTP mapping, cache headers, and
the public response envelope. The server-side Legacy adapter remains the only
path from this layer to the real upstream package.

`next.config.ts` marks the pinned Legacy package as a Node server external. This
prevents Turbopack from attempting to bundle its unsupported dynamic CommonJS
module discovery while preserving the loader boundary in
`legacyApi.server.ts`.

No browser code may import an upstream package, call an upstream URL, pass an
upstream Cookie, or receive a raw upstream response. T009 does not create a
Session, QR flow, Demo-mode switch, mutation endpoint, persistence layer, or
page-level data UI.

## Routes

| Route | Input | Success data | Cache-Control | Timeout |
| --- | --- | --- | --- | --- |
| `GET /api/search` | `q`, `type`, `limit`, `offset` | `SearchResponse` | `public, max-age=300, s-maxage=300` | 10s |
| `GET /api/tracks/:id` | numeric `id` | `Track` | `public, max-age=300, s-maxage=300` | 10s |
| `GET /api/tracks/:id/source` | numeric `id`, `quality` | `PlaybackSource` | `no-store` | 15s |
| `GET /api/tracks/:id/availability` | numeric `id` | `{ state: "verified-playable" | "unavailable" }` | `no-store` | 15s |
| `GET /api/tracks/:id/lyrics` | numeric `id` | `LyricDocument` | `public, max-age=300, s-maxage=300` | 10s |
| `GET /api/tracks/:id/comments` | numeric `id`, `limit`, `offset` | `CommentPage` | `public, max-age=30, s-maxage=30` | 10s |

Search defaults to `type=all`, `limit=20`, and `offset=0`. Track identifiers
must be 1-20 decimal digits. Search types are `all`, `track`, `album`, and
`artist`; source qualities are `standard`, `exhigh`, `lossless`, and `hires`.
Search limits are 1-30, comment limits are 1-100, and offsets are non-negative
integers. Invalid input never reaches the provider.

The availability route requests the normal standard-quality source path only
on the server, then discards the returned URL. It exists for the search filter;
the browser receives a state only and cannot turn it into an audio proxy.

## Envelope And Errors

Every success returns `ApiSuccess<T>` with `meta.requestId`, `meta.mode` set to
`real`, and `meta.fetchedAt`. Every failure returns `ApiFailure` with a stable
`requestId`, safe message, code, and retryability. Failure responses use
`Cache-Control: no-store`.

| Error code | HTTP status |
| --- | ---: |
| `VALIDATION_ERROR` | 400 |
| `AUTH_REQUIRED`, `SESSION_EXPIRED` | 401 |
| `VIP_REQUIRED` | 403 |
| `TRACK_UNAVAILABLE`, `SOURCE_EXPIRED` | 409 |
| `QR_EXPIRED` | 410 |
| `REGION_RESTRICTED` | 451 |
| `RATE_LIMITED` | 429 |
| `UPSTREAM_TIMEOUT` | 504 |
| `UPSTREAM_UNAVAILABLE`, `NETWORK_ERROR` | 502 |
| `UNKNOWN_ERROR` | 500 |

`details` is allowlisted by `apiResult.ts`; it must never contain search input,
Cookie values, QR keys, playback URLs, or a raw upstream body.

## Read Policy

Each provider call has an `AbortController` timeout. Read failures caused by
`RATE_LIMITED`, `UPSTREAM_TIMEOUT`, or `NETWORK_ERROR` receive at most one
retry with a short jittered delay. Validation, access, availability, and other
upstream errors are not retried. `type=all` preserves fulfilled sections and
reports failures in `partialErrors`; only an all-failed result becomes an
`ApiFailure`.

For source and availability reads, the route may inject the authenticated
user's server-only upstream Cookie after resolving the ECHOFORM `sid`. It is
never created from client input, returned in an envelope, logged, or passed to
metadata reads. If no authenticated Cookie exists, the normal bare-anonymous
upstream call is used. The user Cookie is preferred and never merged with an
anonymous-visitor credential.

## Test Gates

Contract tests use injected normalized provider functions only. They cover
success, empty data, malformed input, 429 retry, timeout retry, 502 mapping,
all-search partial success, unavailable source, cache headers, unique request
IDs, and forbidden value isolation. No test calls the network or stores a
Cookie, QR key, playback URL, user profile, or raw upstream response.

This task changes no page component, so page loading and stale-data retention
remain unavailable to test until the consuming discovery, track, comment, and
search features are introduced. The route contracts are the required state
boundary for those future pages.

The E2E runner starts its own local server by default. When a developer already
has this workspace running, `ECHOFORM_E2E_BASE_URL` may explicitly select that
same-origin local server instead; the runner verifies it is reachable and does
not start a conflicting second Next.js instance.
