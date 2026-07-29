# ECHOFORM Testing Strategy

## Purpose

The default test suite is local, deterministic, and free of real provider
requests. It establishes the test boundary before music data, authentication,
or playback behavior is introduced.

## Commands

- `npm run test:unit`: pure, DOM-free state, parser, reducer, and utility tests.
- `npm run test:component`: JSDOM semantic, focus, keyboard, and recovery-state
  component tests.
- `npm run test:contract`: normalized adapter contract tests using sanitized
  deterministic fixtures.
- `npm run test:e2e`: local Playwright critical-path and responsive visual smoke
  tests. Its project-local runner starts and closes only
  `http://127.0.0.1:3100`.
- `npm run test`: runs the four suites above in serial command order.

## Fixture Privacy

Fixtures must follow `tests/fixtures/README.md`. Never commit QR values, cookies,
session values, audio URLs, user information, playlist names, comment text, or
raw upstream responses. Default tests must not depend on an upstream music
service, browser login state, or external network availability.

## Page-State Coverage

For every future page or remote-data panel, the feature task must test the
following states before it can be accepted:

1. Main flow: valid data, its primary interaction, return navigation, and state
   retention.
2. Loading: no flash under 300ms; a local skeleton or progress state after that.
3. Empty: a truthful reason and one recovery action, without invented content.
4. API error: visible error type, local recovery action, retry behavior, and
   retention of still-valid old data.
5. Partial success and expired-login states where the feature supports them.

The current reconstruction has no remote-data page yet, so T002 covers its
existing local homepage shell only. The E2E smoke test captures desktop
`1440x900`, tablet `768x1024`, and mobile `390x844` screenshots, checks that the
main shell and WebGL canvas are visible with stable dimensions, parses each
canvas screenshot to confirm nonblank rendered content, and rejects unexpected
horizontal overflow.

## Artifacts

Playwright output is written to `tests/artifacts/` and ignored by Git. It may be
inspected while validating a task but must not be committed. The runner recreates
the directory as needed; clean it only through a deliberate, approval-gated
operation when material generated files need removal.
