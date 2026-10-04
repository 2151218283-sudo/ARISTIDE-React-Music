# T023 Reply and Comment-Like Probe

Before the 2026-10-04 run, the pinned Legacy package had verified top-level
comment creation and deletion while reply and comment like/unlike were
`MUTATION_NOT_RUN`. This manual probe established those two contracts for a
dedicated test account; its completed result is recorded below.
It is not part of default tests or CI.

The operator must obtain explicit authorization for each requested scope,
the public numeric test track ID, and the rollback actions before running it.
The command is:

```powershell
node scripts/netease-comment-interaction-probe.mjs --live --writes --confirm-external-writes --write-scope reply,comment-like --track-id <public-test-track-id>
```

The scopes can be run separately. Alternatively, `--auto-select-candidate`
replaces `--track-id` when the
authorization explicitly permits a song selected in memory from the dedicated
account's daily recommendations. The script checks that song's comment read
before any write and never prints its ID.

```powershell
node scripts/netease-comment-interaction-probe.mjs --live --writes --confirm-external-writes --write-scope reply,comment-like --auto-select-candidate
```

Each scope first reads the song comments,
creates a uniquely marked temporary parent comment in memory, and locates its
ID through authenticated reads. `reply` creates a reply, locates it, deletes
the reply, then deletes the parent. `comment-like` confirms the new parent is
not liked, likes it, unlikes it, then deletes the parent. The cleanup runs even
if the interaction returns a failed or ambiguous response. If a reply ID cannot
be found, the report must state rollback uncertainty; never upgrade the API
contract solely from a successful add response. A scope failure stops later
scopes. The process logs out and closes the temporary loopback QR page.

Only endpoint names, HTTP status, business code, and field presence/count are
printed. QR contents, Cookie, account profile, comment text, track/comment IDs,
and raw upstream responses remain in memory and must not be saved to evidence
files or fixtures. A success status for both write and rollback is required to
upgrade each scope to `MUTATION_ROLLED_BACK`. If cleanup cannot be confirmed,
record `MUTATION_ROLLBACK_UNCONFIRMED` and stop before app integration.

## 2026-10-04 authorized result

The dedicated account completed QR `801/802/803`, login status, account read,
daily recommendations (33 rows), comment read preflight, and logout. A temporary
parent comment was created and deleted for each scope. The reply create/delete
and comment like/unlike each returned HTTP 200 and business code 200. Reply
visibility was confirmed by read before deletion; the like preflight confirmed
the temporary comment was initially unliked. The report contained no comment
text, entity IDs, account data, QR content, Cookie, or raw responses. Both
scopes are `MUTATION_ROLLED_BACK` for the pinned Legacy provider. This does not
yet establish that the application UI and BFF write paths work.
