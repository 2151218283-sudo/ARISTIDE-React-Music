# Comments and Queue Drawer Specification

> Status: T015 implementation specification
> Scope: read-only comments and the shared queue surface on `/track/[id]`

## Ownership

- `CommentsQueuePanel` owns the shared Drawer/BottomSheet shell, focus
  management, comments read state, pagination, and queue commands.
- `TrackPlayerPage` owns the trigger buttons and the active panel key. It does
  not fetch comments directly and does not create a second player or audio
  element.
- Comments are read through the same-origin `GET /api/tracks/:id/comments`
  envelope. The panel consumes normalized `CommentPage` data only.
- Queue data comes from the public `PlayerProvider` snapshot. Queue commands
  are dispatched through the existing player context; the panel never receives
  an `HTMLAudioElement` or a source URL.

## State model

```ts
type PanelKind = "comments" | "queue";
type CommentsStatus = "idle" | "loading" | "ready" | "error";
```

- Only one `PanelKind` can be active. Clicking the active trigger closes it;
  clicking the other trigger switches content in the same container.
- Comments start loading on the first open for a track. A request uses a stable
  `limit` and `offset`; a newer track or request revision invalidates older
  responses. Existing rows remain visible while a later page is loading.
- The first-page error shows an inline reason and `Retry`. A later-page error
  keeps existing comments and offers `Retry` for that page. No error clears
  previously valid rows.
- Empty comments show `还没有可显示的评论` and do not fabricate a composer.
  A disabled read-only footer states that commenting is not open yet.
- Queue rows are keyed by `queueItemId`, display the current item, and keep
  unavailable tracks visible with a truthful reason. Selecting a playable row
  dispatches `LOAD_TRACK` with the current finite queue and autoplay enabled.
- Removing a row dispatches `REMOVE_FROM_QUEUE`. The removed item and its
  original position are held for five seconds; `Undo` restores the finite queue
  through `SET_QUEUE` without recreating the Audio element. Removing the only
  item leaves the player in its existing safe idle state.
- The queue is a playback session, not a persisted playlist. No localStorage or
  server write is used.

## Shell and interaction

- Desktop: fixed right Drawer, width `min(480px, 42vw)`, with a scrim and a
  stable internal scroll region. It uses z-index token `--ef-z-drawer`.
- Mobile: fixed BottomSheet with `max-height: 78dvh`, bottom safe-area padding,
  a visible close button, and a scrollable body. The page remains at its current
  scroll position and the sheet does not claim gallery wheel-to-exit behavior.
- The shell uses `role="dialog"`, `aria-modal="true"`, a labelled heading,
  Escape/backdrop dismissal, visible focus rings, and a small focus trap. When
  closed, focus returns to the trigger that opened it.
- Opening/closing uses opacity and transform only, with 220ms enter/exit tokens;
  `prefers-reduced-motion: reduce` makes the transition effectively instant.
- All row actions are native buttons with at least 44px hit targets and a
  descriptive accessible name. Destructive remove uses danger styling and no
  confirmation dialog because the five-second Undo is the recovery path.

## Visual states

### Comments

- `idle/loading`: preserve the panel frame; after the short initial delay show
  row-sized Skeleton placeholders rather than a full-screen spinner.
- `ready`: show count, chronological sections from the normalized API ordering,
  author, date, content, reply context, and a `加载更多` action while `hasMore`.
- `empty`: reason plus no-op read-only footer.
- `error`: inline error with retry; old rows remain if a later page failed.

### Queue

- `ready`: current row has text and an icon/state marker, not color alone.
- `empty`: `队列中没有下一首` with a visible `浏览每日推荐` link back to `/`.
- unavailable rows are disabled for selection but retain the original track and
  reason. The current error message is shown inline by the persistent player and
  is not duplicated as a fake availability code.
- after remove: row exits without layout-jumping the shell; an inline polite
  Undo action remains available for five seconds.

## Test matrix

- Component: comment loading, results, empty, first-page error/retry, later-page
  error/retry, pagination; queue ready/current/empty/unavailable, select, remove,
  remove-only safe state, undo; one-open-panel invariant; Escape, backdrop,
  focus return, Tab traversal and reduced motion attributes.
- E2E: desktop Drawer width, mobile BottomSheet safe area, comments pagination,
  queue selection/removal/undo, normal page scroll, and no horizontal overflow at
  1440x900, 768x1024 and 390x844.

## Non-goals

- No comment publishing, reply, like, playlist persistence, drag reorder,
  infinite scrolling, or new upstream write endpoint in T015.
