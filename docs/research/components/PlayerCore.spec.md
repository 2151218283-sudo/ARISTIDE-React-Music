# Player Core Specification

> Status: T006 implementation baseline
> Scope: DOM-free playback state, queue policy, source revision guards, and lyric parsing.

## Ownership

`src/lib/player/` owns deterministic playback state and queue decisions. It may
consume normalized `Track` and `PlaybackSource` models, but it must not import
React, a page component, an upstream provider, or `HTMLAudioElement`.

The future AudioController (T007) will translate this core's commands and
events to one real audio element. T006's controller only accepts injected
`resolveSource`, `play`, and `pause` functions so race behavior can be tested
without a browser.

## State rules

- `playing` is confirmed only by `MEDIA_PLAY`; `PLAY` changes intent but not the
  lifecycle state.
- `PAUSE` changes intent synchronously and invalidates pending play callbacks.
- Each `LOAD_TRACK` increments `loadRevision`; events from older revisions are
  ignored, even when an async resolver cannot be cancelled.
- Sequential and shuffle modes stop at their finite boundaries. Repeat-one is
  the only mode that revisits the current item automatically.
- Automatic source failures may inspect at most one queue-length of items before
  producing `QUEUE_EXHAUSTED`; a user-selected failure remains on that track.
- Lyrics are a projection of Audio time. Missing translations or word timing
  degrade to ordinary synced/plain lines without becoming player errors.

## Public surface

- `types.ts`: snapshot, commands, events, errors, queue and timer models.
- `reducer.ts`: pure state transition functions and initial snapshot.
- `queue.ts`: finite sequential/shuffle/repeat-one policy helpers.
- `lyrics.ts`: LRC, translation and YRC parsing plus binary line/word lookup.
- `controller.ts`: DOM-free async orchestration with revision and intent guards.

## Test gates

The unit suite covers the `PLAYER_STATE_MACHINE.md` 22.1 matrix: lifecycle,
rapid loads, pending play/pause, seek, buffering/stalled recovery, bounded
refresh, finite queue modes, automatic skip, lyrics, sleep timer and stale
revision events. No page loading/empty/error test is part of this pure-core task.
