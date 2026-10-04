# Comment Write Specification

> Status: T023 implementation specification
> Scope: song comment publishing, reply, and like/unlike on `/track/[id]`

## Contract boundary

- Real mode may publish a top-level song comment through the pinned Legacy
  `comment` method (`t=1`, `type=0`). Its dedicated-account create and delete
  rollback is recorded as `MUTATION_ROLLED_BACK` in the API contract.
- Reply (`t=2`) and comment like/unlike passed a dedicated-account mutation
  and rollback probe. All three actions use the same server-held session
  credential and never make direct browser-to-upstream requests.
- Demo mode never fabricates a successful write. Anonymous users are offered
  QR login before a composer is made available.
- The same-origin `POST /api/tracks/:id/comments` accepts JSON containing
  `content`, optional `replyToCommentId`, and `clientMutationId`. Content is trimmed and must be 1-1000
  characters. Neither content nor upstream credentials enter URL, logs, error
  details, or the session mutation result.
- Comment like/unlike uses `PUT`/`DELETE /api/tracks/:id/comments/:commentId/like`
  with JSON `clientMutationId`. No write retries automatically. An authenticated
  `GET /api/tracks/:id/comments` passes the session credential to the Provider
  and returns `no-store`; anonymous reads remain public and short-lived.

## Publishing state

- Composer states are idle, sending, confirmed, rejected, and uncertain.
  Sending disables another submission without removing the draft.
- The UI clears the draft only after the upstream business response confirms
  success, then refreshes the first comments page. It does not invent a new
  comment row from the submitted text or assume immediate upstream visibility.
- A known validation, authentication, or rate-limit rejection stays inline and
  allows a deliberate correction or later submit. No write automatically retries.
- A timeout or transport/upstream failure may have committed. Keep the draft,
  show an inline uncertain result, and provide a read-only list refresh. Do not
  send that mutation again without reliable proof that the first write failed.
- A `clientMutationId` identifies exactly one track and content digest within
  a server session. The digest is an HMAC keyed by the server-held credential.
  Concurrent requests with the same ID share one upstream
  call; confirmed duplicates return the stored result. An ambiguous result is
  retained as uncertain and cannot trigger a second upstream call. Session
  records contain only a digest and an acceptance flag, never comment text.

## Drawer and tests

- The composer shares the existing comments Drawer/BottomSheet and cannot
  alter queue commands, the single Audio element, close/focus behavior, or the
  comments pagination request lifecycle.
- Each normalized comment row offers Reply and a pressed-state like button.
  Anonymous actions open QR login. Reply focuses the composer with a visible
  target and a cancel action. Like/unlike shows a pending state, updates only
  after server confirmation, and refreshes the current list. A failed or
  uncertain mutation keeps its row and an inline recovery message.
- A focused textarea remains visible in the sheet when the soft keyboard
  opens. Inline errors and success text use live regions. The composer remains
  reachable by keyboard and its submit control has a stable size.
- Contract tests cover auth, validation, ID reuse/concurrency, confirmed
  duplicate, ambiguous timeout, and safe upstream argument mapping.
- Component tests cover anonymous login, text validation, sending, confirmed
  refresh, 401/429, uncertain result, and no automatic retry. E2E stays local
  with mocked responses; no real account write runs in default suites.
