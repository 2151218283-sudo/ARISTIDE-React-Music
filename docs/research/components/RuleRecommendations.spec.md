# RuleRecommendations Component Specification

## Ownership

- The `/search` empty-query discovery surface mounts one independent Real-only
  rule-recommendation section. `src/features/discovery/` owns client loading,
  recovery, source labels and queue presentation; `src/lib/music/` owns input
  validation, deterministic ranking, per-seed failure and server Session cache.
- The browser sends only bounded, scoped local-history IDs and timestamps to a
  same-origin `no-store` BFF. The BFF obtains the complete liked-ID set under
  the current Real session. No Cookie, source URL, raw upstream row or unscoped
  legacy history reaches the client result or cache.

## Ranking And Cache

- Use up to five latest qualified, scoped local-history seeds and five liked
  seeds, filling unused slots from the other source to a maximum of ten.
  Liked IDs have no verified timestamp and use a date/user/ID stable ordering.
- For each seed request at most twenty similar songs with concurrency at most
  three. A candidate contribution is source weight (history 3, liked 2) times
  `(21 - originalRank)`; multiple hits add, then score descending and ID
  ascending decide order. Explain matches with actual seed metadata.
- Exclude seeds, all liked IDs, local plays in the preceding seven days and
  duplicate IDs. Verify each remaining candidate against the current identity's
  playback source, discard that short-lived URL and return at most twelve
  verified-playable Tracks, at most two per artist.
- Session cache keys include Real user ID, server-local date and a canonical
  fingerprint of likes and ordered history. Only complete successful reads are
  cached for that day. Mode/auth changes clear the cache; HTTP is `no-store`.
- Each metadata read has the architecture's 10-second timeout, and each source
  check has its 15-second timeout. Timed-out seeds count as partial failures;
  timed-out source checks are excluded and reported separately. Incomplete
  reads never enter the daily cache.
- Explicit authentication failures during seed or source reads remain 401
  errors, never partial results or cached evidence.

## States And Presentation

- Loading is local, delayed and dimensionally stable. Success states source,
  data window and recommendation basis without an AI claim. No samples, no
  playable results, partial seed/source failure and total failure have distinct text
  and recovery actions; prior valid data remains during a retry.
- Demo cannot display a Real result. Anonymous Real users are invited to log
  in. A 401 result offers renewed QR login rather than a normal retry. Old
  unscoped local history is visible only in the library, not in seeds.
- TasteProfile is shown only on the current user's profile. It aggregates
  deduplicated actual Tracks by primary artist and shows three to five classes
  only with at least five samples and three identifiable artists. Percentages
  use the identifiable unique-track denominator and never imply play counts.

## Tests

Unit tests freeze ranking, filtering, fingerprint and taste denominators.
Contract tests cover normalized shapes, no-store, session separation, source
preflight and partial errors. Component and E2E tests cover loading, success,
multiple seeds, insufficient data, no result, partial/all failure, playability,
deduplication, artist limits, keyboard access, Reduced Motion and 1440x900,
768x1024 and 390x844 viewports.
