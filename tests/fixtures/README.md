# Test Fixture Rules

Fixtures must be deterministic, sanitized, and safe to commit. They exist only
to verify locally normalized application behavior; they are not captured
responses from an upstream music service.

Do not add QR payloads, cookies, session identifiers, audio URLs, user profiles,
playlist names, comment content, or raw upstream responses. Use neutral synthetic
identifiers such as `demo-track-001` and document any fixture schema beside the
fixture that uses it.

Live provider verification remains an explicit manual activity in a later task.
It must never be included in the default test commands.
