# EXAM_SECURITY_TEST_REPORT.md

Run 2026-11-08 against a production build and local PostgreSQL. Every security test was first
observed failing against the unfixed code (see `ENGINEERING_CHANGELOG.md`).

| Area (brief §N.10) | Evidence | Result |
|---|---|---|
| Expired / invalid / tampered tokens | `jwt.test.mjs` (REST + WebSocket) | pass |
| Unauthorized exam access, cross-student access | `security-module` S13, `access-control` S12, leak scan | pass |
| Deadline manipulation, late submissions | `submission-integrity` (on-time decided by server; saves after deadline refused) | pass |
| Client clock manipulation | Chrome, page clock ±15 min: no early auto-submit; timer shows real 09:54 (was auto-submitted / 24:54) | pass |
| Duplicate submissions | `submission-integrity` (8 concurrent → 1); old code reproduced 7 rows | pass |
| Retried submission | same receipt, no new snapshot | pass |
| Refresh / restart recovery | Chrome reload keeps attempt and paper; timer from server deadline | pass |
| Concurrent sessions | duplicates logged by heartbeat (pre-existing); **no blocking policy** | not implemented |
| Network disconnection with unsaved edits | Chrome (real offline mode): failure shown; nothing sent; after "crash" + reconnect the draft is restored and saved; a stale draft never overwrites a newer server version; `autosave.test.mjs` 409 on stale saves | pass |
| Audit log integrity | `audit-log.test.mjs`: edit/delete/reorder detected, 25 concurrent appends gapless | pass |
| Compiler isolation | Linux probes (`COMPILER_SECURITY_REVIEW.md`) | pool mode passes except network; **not deployed** |

Totals: `npm test` 113/113; browser 73/73 (exam start 11, short-screen start 11, grading 23, Runs tab 13, receipt 2, clock skew 3, autosave 10).
