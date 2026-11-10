# SYSTEM_ARCHITECTURE.md — LabSubmit

Reconstructed from the code at commit `85240d1` (2026-11-08). `/CLAUDE.md` §8 holds the
short architecture map; this document expands it.

## 1. High-level architecture

```mermaid
flowchart LR
  subgraph Browser
    A[Admin UI /admin]
    L[Lecturer UI /lecturer]
    S[Student UI /student]
    X[Exam surface /student/lab/:id<br/>Monaco + xterm + ExamGuard]
  end
  subgraph Vercel["Vercel — Next.js 14"]
    R[REST route handlers<br/>src/app/api/**]
    AU[requireAuth + JWT<br/>src/lib/auth.ts, jwt.ts]
    D[Domain modules<br/>examTiming, examSubmission,<br/>answerSheet, questionSets,<br/>deviceEligibility, examIntegrity]
  end
  subgraph Railway
    WS[server.js<br/>WebSocket /api/ws]
    EC[ExecutionController]
    CS[CompilerService<br/>gcc / g++ / javac / python3]
    PTY[PtyService + RuntimeSandbox]
    PG[(PostgreSQL)]
  end
  A & L & S --> R
  X --> R
  X <-->|run / input / output| WS
  R --> AU --> D --> PG
  WS --> EC -->|authorizeRun: JWT, ownership,<br/>status, deadline, language, device| PG
  EC --> CS --> PTY
```

Both hosts read the same database and must share a byte-identical `JWT_SECRET`.

## 2. Frontend

- **Routes:** `/` (landing), `/login`, `/register`, `/student`, `/student/lab/[id]`,
  `/lecturer`, `/admin`. Each role dashboard is one route with tabbed sections.
- **Shell:** `AppShell` (sidebar ≥ `lg`, drawer below) with `STUDENT_NAV` / `LECTURER_NAV` /
  `ADMIN_NAV`. The exam surface deliberately does **not** use the shell.
- **State:** `AppContext` holds the user, token and theme. Pages fetch with `fetch` +
  `Authorization: Bearer`. No data-fetching library.
- **Design system:** `src/components/ui/index.tsx` primitives; tokens in `tailwind.config.js`.
- **Exam components:** `OnlineIDE` (files + Monaco), `Terminal` (xterm over WebSocket,
  captures runs for the answer sheet), `ExamGuard` (fullscreen/tab/devtools signals),
  `AnswerSheet` (renders the lecturer's configured sections), `QuestionPaper`.

## 3. Backend

- **Entry:** `server.js` → Next request handler; `upgrade` on `/api/ws` → `ExecutionController`
  (loaded through `tsx`).
- **REST:** Next route handlers, one file per resource; every non-public route calls
  `requireAuth(req, roles)`; lecturer routes additionally check `lab.lecturerId`.
- **Domain modules** (pure where shared with the client): exam status/deadline
  (`examTiming`), single idempotent `finalizeSubmission()` (`examSubmission`), section
  catalogue and validation (`answerSheet`), set assignment and student-paper shaping
  (`questionSets`), device policy (`deviceEligibility`).

```mermaid
sequenceDiagram
  participant C as Client
  participant R as Route handler
  participant A as requireAuth
  participant P as Prisma
  C->>R: HTTP + Bearer token
  R->>A: verify JWT, check role
  A-->>R: session or 401/403
  R->>P: query scoped by session.userId / lab.lecturerId
  P-->>R: rows
  R-->>C: payload shaped for the role
```

## 4. Database

PostgreSQL via Prisma; 17 models. Core relations:

```mermaid
erDiagram
  User ||--o| LecturerProfile : has
  User ||--o| StudentProfile : has
  Branch ||--o{ StudentProfile : enrols
  Branch ||--o{ Subject : offers
  User ||--o{ Lab : "authors (lecturer)"
  Subject ||--o{ Lab : for
  Lab ||--o{ AnswerSheetSection : configures
  Lab ||--o{ QuestionSet : has
  QuestionSet ||--o{ Question : contains
  Lab ||--o{ LabWorkspace : attempts
  User ||--o{ LabWorkspace : "student"
  QuestionSet ||--o{ LabWorkspace : "assigned to"
  LabWorkspace ||--o{ LabFile : holds
  LabWorkspace ||--o{ AnswerSheetResponse : records
  Lab ||--o{ Submission : receives
  Submission ||--o{ SectionEvaluation : "schema only"
  LabWorkspace ||--o{ ExecutionRecord : "schema only"
  Lab ||--o{ ExamViolation : logs
  Lab ||--o{ ExamAdminAction : audits
```

Full field-level documentation: `DATABASE_DOCUMENTATION.md` (pending — see roadmap).

## 5. Authentication & authorisation

- Login (`/api/auth/login`) checks bcrypt hash, issues HS256 JWT (7 days) carrying
  `userId`, `role`, `name`, `email`/`rollNumber`.
- Student self-registration is gated by admin-defined roll-number ranges.
- Token accepted from `Authorization: Bearer` or `token` cookie.
- Role enforcement is server-side in every route (`requireAuth`) and in the WebSocket
  (`authorizeRun`). Frontend navigation is convenience only.

## 6. Compiler / execution architecture

```mermaid
sequenceDiagram
  participant T as Terminal (xterm)
  participant W as ExecutionController
  participant DB as PostgreSQL
  participant C as CompilerService
  participant P as PtyService
  T->>W: run {filename, code, files, token, labId}
  W->>DB: authorizeRun (token, workspace, status, deadline, language, device)
  W->>W: validate filenames (single segment, allow-list)
  W->>C: write files to temp dir, compile (execFile, minimal env, limits)
  C-->>W: success / compile error
  W->>P: spawn under ulimit wrapper (minimal env, optional uid drop)
  P-->>T: output stream (program) + system banners
  T->>W: input / resize / stop
  P-->>W: exit → cleanup temp dir
```

Limits: 15 s compile, 60 s wall-clock runtime, 5 MB output, CPU-seconds/file-size/memory
`ulimit`s (iteration 1). Isolation limits are documented in `SECURITY_AUDIT.md` S4.

## 7. Deployment

See `/DEPLOYMENT.md`. Vercel serves UI + REST (no `node-pty`); Railway runs the
`Dockerfile` image (`node:20-alpine` + build-base, python3, OpenJDK 17) for `server.js` and
hosts Postgres. Schema is applied with `prisma db push`.
