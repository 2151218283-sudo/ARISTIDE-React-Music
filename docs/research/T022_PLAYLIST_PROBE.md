# T022 Dedicated Playlist Probe

## Scope and authorization

Run only with the dedicated test account and the current conversation's approval.
The manual script is `scripts/netease-playlist-management-probe.mjs`. It uses the
pinned Legacy `NeteaseCloudMusicApi@4.32.0` package. It must not run in default
tests, CI, or the application. Its explicit flags are `--live --writes
--confirm-external-writes --write-scope playlist-management`.

The probe may read one existing owned playlist to compare `playlist_detail`
metadata, embedded tracks, and a bounded `playlist_track_all` page. It may
create one randomly named private playlist, update only that temporary
playlist's name, description, and tags with the separate package methods,
publish it with `playlist_privacy`, and delete it. It must not change an
existing playlist or test the unrelated subscription endpoint. The package
provides no public-to-private operation, so that direction remains blocked.

## Safety and reporting

- Verify QR `803` with `login_status` and `user_account` before writes.
- Check the generated playlist name is absent before creation. Keep the name,
  playlist ID, QR image/key, Cookie, account details, and raw responses only in
  process memory. Do not print or persist them.
- After any attempted creation, locate the temporary playlist by its unique
  name if the create response has no usable ID. Never delete by a guessed ID.
- Do not retry a write after a timeout or ambiguous response. Perform bounded
  read-only lookups for verification and cleanup. Delete the identified
  temporary playlist once, even when a later probe step fails, then read the
  account playlist list to verify absence. If cleanup cannot be confirmed,
  report `MUTATION_ROLLBACK_UNCONFIRMED` and stop.
- Always attempt upstream logout and close the temporary loopback QR page.
  The final report contains only endpoint names, HTTP/business codes, boolean
  field checks, and aggregate counts. A failed probe does not upgrade the API
  contract or unlock Real writes.

After a successful probe, update the API contract with separate evidence for
private creation, each edit method, private-to-public publishing, public and
private detail reads, and deletion. The application may only wire methods that
actually passed and were cleaned up.

## Result: 2026-10-04

The authorized dedicated-account run completed with exit code 0. The private
temporary playlist was created, edited through all three independent methods,
published, deleted once, and confirmed absent from the account list. The
session logged out. All write steps and their detail verification reads returned
HTTP 200 / business code 200. An anonymous private-detail read returned 401.
One existing playlist had matching `trackCount`, embedded tracks, and
`trackIds` counts of 140; `playlist_track_all` returned the requested 50 songs.
The report contained no account or entity values.
