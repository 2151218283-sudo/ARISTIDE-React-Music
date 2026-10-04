# T025 Settings Experience Specification

> Status: implementation contract
> Scope: `/settings`, local preferences, and the existing Player Sleep Timer

## Ownership and storage

- `ThemeProvider` remains the sole owner of `echoform:theme-preference`. The
  settings page and global theme switcher use the same context. Guest and Demo
  sessions retain their saved preference but apply INK; unavailable artwork also
  follows the T024 fallback contract. A failed storage read or write is visible
  next to the theme setting; the in-memory choice remains usable.
- `SettingsProvider` owns other non-sensitive preferences under
  `echoform:settings:v1`. Its payload is `{ version: 1, reducedMotion, quality,
  mode, rememberVolume, volume, showTranslation, preferWordTiming }`. Defaults are
  `false`, `standard`, `sequential`, `true`, `1`, `true`, and `true` respectively.
  Valid qualities are `standard`, `exhigh`, `lossless`, and `hires`; volume is a
  finite number from 0 to 1. Sleep Timer, source URL, session data, cookies, and
  lyrics never enter storage.
- Missing storage uses defaults. Invalid fields fall back individually, retain
  valid fields, and show a recovery message. Unknown versions are not
  overwritten automatically. A read or write exception leaves preferences
  active in memory and shows an inline persistence error. Hydration must finish
  before settings controls present saved values or player defaults are applied.
  The user may explicitly restore defaults; that action affects only local
  preferences, not account or history data.
- Theme selection is immediate. Default quality applies to the next source
  resolution, including retry or refresh; it does not interrupt a playing
  source. The actual source quality may be lower than requested. Player mode and
  volume changes from either settings or transport use the same Player commands.
  With volume memory off, current volume stays unchanged, but the next page
  load uses 1. Re-enabling memory saves the current user volume.
- Effective reduced motion is `systemReduce || userReducedMotion`. The app
  preference cannot override an operating-system reduce request. CSS and JS
  motion consumers use the same effective value and respond to changes without
  remounting the persistent player or WebGL scene.

## Page and controls

- Use a normal scrolling settings page with Appearance, Playback, Lyrics, and
  Sleep Timer groups. Theme uses a three-option segmented control; binary
  preferences use switches; quality and mode use radio groups or a menu; timer
  durations use 15/30/45/60-minute choices plus end-of-current-track. Each
  control has a persistent label and any needed helper text. Immediate settings
  have no Save button.
- Show storage errors adjacent to the affected control with `role="alert"` or
  an associated description. The page has no remote-data loading state; local
  hydration, unavailable storage, malformed data, and write failures are its
  explicit states. Guest/Demo theme limitations are explained without disabling
  unrelated local settings.
- The timer group shows an active remaining duration or the end-of-current-track
  state, and offers a clear Cancel action. End-of-track is unavailable without
  a current track. A reset-to-defaults action does not clear history, account
  state, or the currently playing queue.

## Sleep Timer runtime

- Reuse `SleepTimer`, `SET_SLEEP_TIMER`, `SLEEP_TIMER_TICK/FIRED`, the controller,
  and the one `PersistentAudioHost`. Duration timers use an absolute `firesAt`.
  Schedule the deadline independently of animation frames, update the final
  three-second temporary gain, and reconcile against wall time when the page
  becomes visible or focused. A suspended browser may deliver a callback late;
  the next callback or foreground reconciliation fires overdue timers at once.
- `end-of-track` is bound to the current track. Natural media `ended` pauses
  before queue advancement, including repeat-one. Manual replacement of that
  track cancels this timer; a same-track source retry or refresh does not.
  Unknown duration shows no invented seconds and waits for real media `ended`.
- A stale deadline callback after cancel or replacement cannot fire. At expiry,
  invalidate pending play intent and pause the Audio before restoring the
  temporary gain to 1. Cancellation and replacement restore gain immediately.
  Never alter the user volume, mute state, system volume, or queue. Successful
  logout cancels the timer; page refresh creates no timer.

## Acceptance

- Unit: schema/version/value recovery; source quality request; timer fade,
  cancellation, replacement, natural end, background catch-up, stale callbacks,
  and saved-volume invariants.
- Component: hydration, all controls and keyboard states, guest/Demo theme,
  storage failure messages, cross-entry mode/volume updates, lyric preferences
  and fallback, timer countdown and cancellation, and logout.
- Contract: existing same-origin source route accepts the four qualities,
  rejects invalid quality, and preserves its normalized actual-quality result.
  No live provider call.
- Local E2E: preference reload, timer refresh clearing, route continuity, hidden
  tab reconciliation, end-of-track without queue advancement, storage errors,
  OS and user reduced motion, and 1440x900, 768x1024, 390x844 plus 200% zoom.
  Check focus, no overlap or horizontal overflow, and existing canvas pixels.
- Complete `npm.cmd run test`, `npm.cmd run check`, sensitive-data review, and
  `git diff --check` before T025 completion. No real account probe is part of
  default testing.
