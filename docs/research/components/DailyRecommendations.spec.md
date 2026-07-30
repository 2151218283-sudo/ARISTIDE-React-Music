# ECHOFORM Daily Recommendations Specification

## Scope

- Owns the session-aware daily recommendation read boundary, the explicit
  `real` / `demo` data-mode switch, and the homepage recommendation status
  surface.
- Target files: `src/app/api/recommendations/**`, `src/app/api/mode/**`,
  `src/lib/music/**` daily-read capability, `src/lib/session/**` mode and
  recommendation cache state, `src/features/discovery/**`,
  `src/features/auth/AuthProvider.tsx`, and `src/components/HomeExperience.tsx`.
- T011 deliberately does not replace the legacy Project data consumed by the
  WebGL filmstrip. T012 will migrate the gallery from Projects to normalized
  Tracks after this data boundary is verified.

## Server Contract

### Daily recommendations

`GET /api/recommendations/daily` always responds with the standard ECHOFORM
envelope and `Cache-Control: no-store`.

```ts
type DailyRecommendationSource = "personal" | "public" | "demo";

interface DailyRecommendations {
  date: string; // server-local YYYY-MM-DD
  source: DailyRecommendationSource;
  tracks: Track[];
}
```

- A new or existing anonymous Real session reads the Real Provider's public
  new-song selection and returns `source: "public"`. It is never described as
  a personal daily recommendation.
- An authenticated Real session reads the authenticated upstream
  `/recommend/songs` capability and returns `source: "personal"`.
- An empty personal list makes one public-selection read and returns
  `source: "public"`; it does not leave the gallery blank.
- A Real upstream error is returned as a sanitized recoverable failure. It
  never changes the session's mode or synthesizes Demo data.
- A Demo session reads only `DemoMusicProvider` and returns `source: "demo"`.
  It contains no Real user or upstream values.
- A session cache key includes the server-local date and identity:
  `personal:<userId>:<date>`, `public:<sessionId>:<date>`, or
  `demo:<sessionId>:<date>`. Cache contents exist only in process memory and
  are cleared when authentication changes or the data mode changes.
- Read requests time out after 10 seconds and retry only once for 429, timeout,
  or network errors. Private and mode responses are never HTTP cached.

### Data mode

`PUT /api/mode` accepts only `{ "mode": "real" | "demo" }` and returns the
normalized `{ mode, user }` public session state using `no-store`.

- A missing session creates a new session before applying this explicit user
  choice and returns its opaque cookie only through `Set-Cookie`.
- New sessions start in `real`; no error handler may invoke this endpoint.
- In `demo`, the returned public `user` is `null`, while the server may retain
  a previously verified Real credential only in memory. Switching back to
  `real` reveals the normalized verified user again, or the normal guest state
  if authentication has expired.
- Browser storage and URLs never contain the mode, upstream cookie, QR key,
  raw response, or user-specific recommendation cache.

## Client Contract

### AuthProvider mode state

- `AuthProvider` restores and exposes `mode`, `modeChanging`, and
  `setMode(mode)` together with the normalized public user.
- Mode changes call `PUT /api/mode` only after the user presses a visible
  command. Before the request, the provider dispatches Player `UNLOAD`.
- Discovery requests are aborted when mode or authentication changes. A failed
  mode request keeps the existing mode and current visible recommendation
  state.

### DailyRecommendationStatus

- The status surface is an absolutely positioned, pointer-enabled homepage
  overlay with a stable reserved width and height. It does not resize, replace,
  or alter the WebGL canvas boundary.
- It uses existing ECHOFORM semantic tokens and `TextButton`; commands have a
  minimum 44px target, visible focus, and concise Chinese labels.
- Loading remains local to the surface and exposes `aria-live="polite"`; it
  never hides the gallery behind a full-page spinner.
- Status is communicated by text as well as color. A failed read uses
  `role="alert"`; success and loading use `role="status"`.
- Motion is limited to opacity/transform crossfades and respects Reduced
  Motion. No new decorative animation is introduced.

| State | Visible label | Actions |
| --- | --- | --- |
| Real guest public | `PUBLIC SELECTION` | `扫码查看你的日推` |
| Real authenticated personal | `YOUR DAILY SIGNAL` | none |
| Real authenticated public fallback | `PUBLIC SELECTION` | `重新加载日推` |
| Loading | `正在载入今日推荐` | none |
| Empty public selection | `暂时没有可展示的推荐` | `重新加载` |
| Real read failure | `无法载入今日推荐` | `重试`, `使用演示数据` |
| Demo | `DEMO` | `返回实时数据` |

The login prompt opens the existing QR dialog. It does not claim that a public
selection belongs to the current visitor.

## Acceptance and Test Boundaries

- Unit tests cover cache identity/date behavior, cache invalidation after mode
  or auth changes, and mode's public-user isolation.
- Contract tests cover guest public data, authenticated personal data, empty
  personal fallback, sanitized 503/timeout, one retry, no automatic Demo,
  no-store headers, explicit enter/exit Demo, and no server-only values in
  responses.
- Component tests cover loading, personal/public/empty/error/demo labels,
  retry, enter/exit Demo, login prompt, fixed surface bounds, and player unload
  on a successful mode change.
- E2E uses local route interception at 1440px, 768px, and 390px for the main
  flow, loading, empty data, 503, timeout, retry, Demo entry/exit, and stable
  WebGL canvas dimensions. Live authenticated daily recommendations remain a
  manual account test and are not part of default automation.
