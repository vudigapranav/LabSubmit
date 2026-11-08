# EXAM_SESSION_SECURITY.md

## What an "exam session" is here

There is no separate session token. An attempt is identified by the authenticated user (HS256 JWT,
7 days, signature-verified on every request) plus their own `LabWorkspace` for that exam. Each tab
generates a random `sessionId` (sessionStorage); the first one to start the attempt is recorded on
the workspace.

| Requirement | Status |
|---|---|
| Session ownership verified on every request | ✅ workspace looked up by `(labId, token.userId)`; never by a client-supplied id |
| Exam access windows enforced server-side | ✅ status + effective deadline on every action and every run |
| Expiry | ✅ JWT expiry (7 d); attempt ends at the effective deadline regardless of token |
| Invalidation after completion | ✅ submitted workspace refuses all actions and runs (repeat submit → receipt) |
| Recovery after disconnect/refresh/restart | ✅ state is server-side; the timer resumes from the server deadline (verified in Chrome) |
| Concurrent sessions | ⚠️ detected and logged via heartbeat (`duplicateSession`), **not blocked**; no lecturer policy setting |
| Hijacking protection | ⚠️ bearer tokens in `localStorage`; no binding to device/IP; no server-side revocation (S9) |
| Secure session tokens | ✅ HS256, pinned algorithm, no fallback secret, startup refuses a missing secret |

## Limits stated plainly

- Browser signals (blur, visibility, fullscreen) are signals, not evidence of misconduct, and cannot
  see other devices or applications.
- Device class comes from client-controlled headers (CLAUDE.md §5).
- A stolen token works until it expires; logout is client-side.
