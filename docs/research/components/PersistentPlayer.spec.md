# Persistent Player Specification

> Status: T007 implementation baseline
> Scope: application-level audio host, public player context, persistent player bar, progress, volume, mode and recovery controls.

## Ownership

- `PlayerProvider` is mounted once in the root layout and owns one T006 controller.
- `PersistentAudioHost` owns the only `HTMLAudioElement`, media listeners, source application, time projection, buffering and stalled recovery.
- Pages dispatch normalized commands through the public player context. They never receive the audio element or call media methods.
- React consumers receive a public snapshot without `PlaybackSource.url`, shuffle internals or source-load origin. The source remains inside the controller/audio host boundary.
- The default resolver calls only the same-origin `/api/tracks/:id/source` contract. T007 does not implement an upstream Provider or silently substitute Demo data.

## Persistent player bar

- Idle with no selected track is visually hidden and reserves no content inset.
- Loading, ready, playing, paused, buffering, stalled, ended and error keep a stable outer footprint.
- Desktop uses an unframed bottom band: track identity on the left, transport in the center, volume on the right, with a full-width progress row.
- Mobile keeps track identity, previous/play/next and a touch-safe progress rail. Mode and browser volume controls are hidden; system volume remains authoritative.
- Active bars reserve content space plus `safe-area-inset-bottom`; they never cover the last list item or system gesture region.
- Enter/exit uses opacity and transform only, lasts at most the player motion token, and becomes effectively instant under Reduced Motion.

## Controls

- All icon controls use Lucide icons and have at least a 44x44px hit target with specific labels including the current track where relevant.
- The main control reports playing only after `MEDIA_PLAY`. Loading/buffering keeps the current play/pause intent visible with a local progress ring.
- Previous and next expose real finite queue boundaries. Disabled controls include an explanatory title.
- Mode cycles sequential -> shuffle -> repeat-one and names both the current and next mode.
- `ProgressRail` is a native range input with linear played/buffered rendering, 5-second arrow steps, 15-second Shift+Arrow steps and a formatted `aria-valuetext`.
- Pointer preview does not seek Audio until commit. Unknown duration disables the rail without changing layout.
- Desktop volume uses a mute button and native range input. Muting never overwrites the saved non-zero volume. Mobile does not render a custom volume slider.

## Error and status behavior

- Autoplay blocked stays paused and keeps the play button operable.
- Fatal errors display the normalized reason inline with Retry when retryable and Next when a finite successor exists.
- Empty queue is expressed through disabled finite controls and readable status, not a fabricated item.
- Buffering/stalled state is announced in one polite live region and never freezes unrelated page interaction.
- Source URLs are confined to the runtime Audio `src`; they are absent from React-rendered text/data attributes, public snapshots, logs and persistence. Raw upstream responses and credentials never enter client markup or state.

## Test matrix

- Component: idle, loading, ready, playing, paused, buffering, stalled, autoplay blocked, empty queue, unavailable/error, Retry and Next.
- Media integration: source application order, metadata, play/pause, time, progress, seeked, ended, media error, volume/mute and one audio element.
- Route persistence: client navigation across at least three ECHOFORM routes retains the same audio DOM node and player state.
- Visual: 1440x900, 768x1024 and 390x844; 200% equivalent zoom; Reduced Motion; no overlap, clipping or unexpected horizontal scroll.

## T018S High-Frequency Timeline Override

- Player context exposes two external subscription surfaces. The public
  semantic snapshot contains queue, track, intent, playback/network/seek
  status, errors and finite-control availability, but excludes volatile
  `currentTimeMs` and `bufferedUntilMs`. It only notifies when one of those
  semantic values changes.
- A separate timeline snapshot supplies `currentTimeMs`, buffered duration,
  media duration and load revision to time consumers. `ProgressRail` uses it
  for linear visual and ARIA updates; `LyricsViewport` uses it to resolve the
  actual active line/word. Both retain `audio.currentTime` as the sole time
  source and keep browser-event updates while hidden or under Reduced Motion.
- The audio host subscribes to semantic lifecycle changes for source, volume,
  playback and recovery synchronization. A `MEDIA_TIME` frame must not cause
  source application, output-volume work, player-bar rendering or unrelated
  page rendering.
- `canPrevious` may notify when its boolean threshold changes, but a changing
  millisecond value alone cannot republish the public snapshot. `loadRevision`,
  SEEK, pause precedence, media error handling, source refresh, one Audio
  element and route persistence are unchanged.
- Component tests drive repeated timeline frames and prove that a timeline
  consumer updates while an AppShell-equivalent semantic consumer and a full
  non-time selector retain their render counts. Existing media integration
  tests continue to cover metadata, seek, buffering, errors and background
  recovery.
