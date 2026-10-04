# Playlist Management Specification

## Scope

T022 owns the local playlist detail route, public share URL, and authenticated
playlist writes. The route is `/playlist/[id]`; it never links to the source
portfolio. A public playlist can be read without a session. Mutations require
the ECHOFORM session and are sent through same-origin BFF handlers.

## State contract

- Read states: loading, ready, empty playlist, not found, permission error, and
  retryable upstream error. Existing valid detail stays visible while a retry
  is pending.
- Mutation states: idle, submitting, confirmed, and inline failure. A second
  submit for the same intent is ignored until the first response arrives.
- Delete and track removal require confirmation before sending an upstream write.
  Cancel restores focus to the action trigger; a confirmed track removal returns
  focus to the track section after refresh. The page navigates to `/library` only
  after the service confirms deletion.
- Share first calls `navigator.share` when available. Any rejected or missing
  Web Share API falls back to copying the local `/playlist/[id]` URL.
- Anonymous users can read public detail and see a login action for writes.
- The add-to-playlist menu must not retain or expose playlist names across an
  account or mode change. A failed list request does not present stale targets.

## Upstream boundary

The Legacy 4.32.0 contract now verifies public and private `playlist_create`,
`playlist_delete`, `playlist_tracks`, separate name/description/tags updates,
and private-to-public `playlist_privacy` with a dedicated account and temporary
playlist cleanup. Real mode may use these independent methods after BFF
validation and owner checks. The batch update interpolates JSON strings and
must not be used. The pinned package has no public-to-private operation, so
the UI must not present visibility as a two-way toggle.

Editing presents name, description, and tags. Since the upstream methods are
separate, save each changed field as one confirmed mutation. Stop on the first
failure, refresh the detail, and report that earlier confirmed fields may have
saved. Publishing a private playlist requires a separate confirmation because
the pinned Provider cannot reverse it. Cover editing remains unavailable.

Real mode permits both public and private creation. Private detail is available
to the owner and returns 401 without a Cookie in the dedicated-account probe.
The detail editor submits changed name, description, and tags sequentially with
distinct mutation IDs. Name is 1-40 characters; description is at most 1000
characters; tags are at most three comma-separated values of 1-20 characters.
The BFF accepts an explicit `field` and only the corresponding value; publish
has no value and is rejected unless the owned playlist is currently private.
An uncertain response must be followed by a detail refresh before further work.

Demo mode preserves the existing rule that it does not fabricate account
writes. It can render deterministic public playlist detail and share links.

## Accessibility and layout

The page has one focusable heading, an explicit track list, labelled action
buttons, a modal confirmation with a focus return target, and no full-screen
spinner. Desktop, tablet, and mobile layouts must avoid overlap and horizontal
scrolling. The share fallback copies only the local URL.

## Verification

Contract tests cover validation, session boundaries, mutation idempotency,
no-retry writes, nested `playlist_tracks` success envelopes, and public detail
normalization. Component and E2E tests cover loading, empty, error, system
share and fallback, partial edit failure, private creation, publish confirmation,
delete confirmation, and responsive route loading. No live probe is part of the
default test command. The dedicated-account Provider probe was completed
separately; application E2E uses local sanitized responses only.
