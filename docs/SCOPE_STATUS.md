# SCOPE_STATUS.md — modules N–T of the 2026-11-08 brief

Every capability requested, classified using the brief's own categories. "Verified" means automated
or browser evidence exists (`EXAM_SECURITY_TEST_REPORT.md`, `SECURITY_TEST_RESULTS.md`). Nothing here
is listed as done because a screen renders.

**Legend:** ✅ implemented and verified · 🟡 implemented, partially verified / partial · 📐 designed, not
implemented · ⛔ blocked on an external decision or infrastructure · ❌ not implemented

## Conflicts with the product definition (need an owner decision before any work)

| Request | Conflict |
|---|---|
| Hidden test cases, batch execution, automated/partial scoring (P.5, P.7, U.11) | CLAUDE.md §1: "There is no auto-grading." Evaluation is human by design. |
| SQL / PL/SQL database workbench, database engine restrictions (S.4, P.1, P.6) | New product area with its own isolation problem (per-student databases); nothing exists. |
| Saved practice projects, achievements/gamification (O.3, O.4) | Outside "laboratory examination platform"; gamification in an exam tool is a product choice. |
| Question types: multiple-choice, descriptive (P.2) | Exams are programming + answer sheet; MCQ is a different assessment model. |

## N. Examination security

| Item | Status | Where / why |
|---|---|---|
| Server-side session validation, ownership, access windows | ✅ | `EXAM_SESSION_SECURITY.md` |
| Session expiry, invalidation after completion | ✅ | JWT expiry; submitted attempts refuse all actions |
| Lecturer policy for concurrent sessions | 🟡 | detected + logged; no blocking policy setting |
| Hijacking protection / revocation | ❌ | S9 (needs async `requireAuth` across routes) |
| Server-authoritative timer, clock-skew correction, periodic sync | ✅ | iteration 12; Chrome ±15 min verified |
| Refresh / restart recovery without timer reset | ✅ | server deadline; browser reload verified |
| Autosave, local draft preservation, retry with backoff, conflict detection (N.3) | ✅ | iteration 14 (`useFileAutosave`, 409 on stale saves); Chrome: offline → crash → recovered; stale draft never restored |
| Save / connectivity status indicator | ✅ | "All changes saved / Saving / Unsaved / Offline — kept in this browser / Not saved: …" in the IDE header |
| No timer extension on reconnect | ✅ | deadline is server state; saves after it are refused |
| Visibility, focus, fullscreen event logging | 🟡 | pre-existing `ExamGuard` + `ExamViolation`; no per-session sequence numbers; no configurable collection policy |
| Disclosure of monitoring policy to students | ❌ | needs institutional wording |
| Rules engine, risk scoring, review queue, resolution (N.5) | 🟡 | NORMAL/WARNING/FLAGGED derivation + timeline exist; no configurable rules, review states or resolution |
| Immutable, hashed, versioned submissions; idempotent; server timestamps; receipts | ✅ | iteration 11 |
| Exam editor actually visible | ✅ | iteration 14 fixed a pre-existing layout bug (editor ~5 px tall at every screen size) |
| Tamper-evident centralised audit log, search, export, verify | ✅ | iteration 13 (`AUDIT_LOGGING_DESIGN.md`) |
| Audit retention policy | 📐 | design in `AUDIT_LOGGING_DESIGN.md`; not automated |
| Permission matrix + automated authorisation tests | ✅ | `ROLE_PERMISSION_MATRIX.md`, `API_SECURITY_MATRIX.md` |
| Compiler: limits, uid isolation, cleanup, queue/concurrency limits | 🟡 | code verified on Linux; **not deployed** (needs Railway setting) |
| Compiler: network isolation, syscall filtering | ⛔ | needs a sandbox (nsjail/bwrap or runner service) — owner approval |

## O. Student experience

| Item | Status | Where / why |
|---|---|---|
| Dashboard: upcoming/active/completed exams, results | ✅ | pre-existing `/student` |
| Subject-wise performance, coding activity, notifications | ❌ | |
| Assignment history: submissions, marks, feedback, section breakdown | 🟡 | results + section breakdown exist; no version history or search for students |
| Re-evaluation status | ❌ | no re-evaluation workflow exists |
| Saved coding projects, templates, import/export | ❌ | see conflicts |
| Achievements | ❌ | see conflicts |
| Keyboard / screen-reader accessibility | 🟡 | shared primitives give labels, focus ring, dialog ARIA, reduced motion (STATE.md); no WCAG audit performed |
| Autosave with crash recovery and conflict detection | ✅ | iteration 14 for code files; answer-sheet sections autosave (pre-existing) without a local draft |

## P. Faculty experience

| Item | Status | Where / why |
|---|---|---|
| Exam builder: sections, reorder, marks, schedule, languages, preview, draft/publish | 🟡 | pre-existing configurator + question sets; reordering is button-based, not drag-and-drop |
| Question bank across exams, tags, difficulty, versioning | ❌ | questions live inside one exam's sets |
| Bulk student import (CSV/XLSX) | ❌ | students self-register in admin ranges (see S28) |
| Marks export (CSV/XLSX) | ❌ | the audit log exports CSV; marks do not |
| Test-case management | ❌ | see conflicts |
| Exam preview as a student | 🟡 | answer-sheet and per-set paper previews exist; no full simulated attempt |
| Manual grading: inspection, partial/section marks, comments, regrading, history | ✅ | iterations 6, 7, 11, 13 (history via audit log + snapshots) |
| Rubrics beyond per-section marks | ❌ | |
| Result publication: draft, publish, withdraw, history | 🟡 | publish/withdraw per submission with audited history; no batch approval or re-evaluation workflow |

## Q. Live exam control room

| Item | Status |
|---|---|
| Real-time monitoring dashboard, connection/execution monitoring, faculty actions | ❌ — data sources exist (`lastActivityAt` heartbeats, `ExecutionRecord`, `ExamViolation`, snapshots); no live view or SSE/WebSocket channel |

## R. Reliability and operations

| Item | Status | Where / why |
|---|---|---|
| Automated backups, encryption, restore testing | ⛔ | Railway Postgres backups are a hosting setting; nothing in the repo; restore never tested |
| Disaster-recovery plan, RTO/RPO | 📐 | not written; needs hosting facts (plan, backup frequency) |
| Background job queue, worker scaling | ❌ | execution runs in-process on one Railway instance |
| Error monitoring, correlation IDs | ❌ | console logging only |
| Rate limiting | 🟡 | login; WebSocket runs per user; payload sizes. Not: submissions, admin endpoints, connections per IP |
| CI/CD | ❌ | `npm test` needs Postgres + compilers + a running server; no workflow file yet |
| Lint | ❌ | `npm run lint` still has no config |
| Regression tests | ✅ | 111 automated + 52 browser checks |
| Database performance monitoring | ❌ | |

## Documents

Created for implemented work: `EXAM_SECURITY_ARCHITECTURE.md`, `EXAM_SESSION_SECURITY.md`,
`AUDIT_LOGGING_DESIGN.md`, `ROLE_PERMISSION_MATRIX.md`, `EXAM_SECURITY_TEST_REPORT.md`, this file.

**Deliberately not created:** the other ~29 requested documents (student, faculty, control-room,
infrastructure). Each would describe software that does not exist; writing them now would be design
fiction presented as documentation. They should be written alongside the work they describe.
