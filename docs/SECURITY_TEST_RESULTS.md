# SECURITY_TEST_RESULTS.md

Final run: 2026-11-08, production build (`npm run build`, `NODE_ENV=production node server.js`), local
PostgreSQL, real compilers. All fixtures self-delete (0 rows left afterwards).

## Automated suite — `npm test` (91 tests)

| File | Tests | Covers | Result (prod) |
|---|---|---|---|
| `execution-security.test.mjs` | 12 | S1–S4: env, traversal, shell injection, file-size limit; C/C++/Java/Python regression | 12/12 |
| `access-control.test.mjs` | 11 | S5, S6, S12, filename rule | 11/11 |
| `auth.test.mjs` | 7 | S7: enumeration, throttling, role tabs | 7/7 |
| `jwt.test.mjs` | 17 | expiry, tampering, `alg:none`, HS512, missing/published secret, 3-role login, role matrix, startup refusal | 17/17 |
| `framework-hardening.test.mjs` | 4 | S8: optimiser off, stray upgrades closed (production only; skip in dev) | 4/4 |
| `execution-records.test.mjs` | 11 | run records, faculty-only access | 11/11 |
| `section-evaluation.test.mjs` | 13 | mark validation, ownership, publish rules | 13/13 |
| `security-module.test.mjs` | 16 | S10, S11, S13, S14, S15, S16, S17, S18, S23 | 16/16 |
| **Total** | **91** | | **91/91** (dev: 87 + 4 skipped) |

Every security test in the table was first run against the unfixed code and **failed** (baseline evidence
in `ENGINEERING_CHANGELOG.md`), except S1-compiler (`/proc` include; Linux-only, skipped on macOS).

## Browser checks (system Chrome via playwright-core, production build)

| Script | Checks | Result |
|---|---|---|
| exam start (plain + question-set exam; S13 regression) | 11 | 11/11 |
| section grading (lecturer + student desktop/phone) | 23 | 23/23 |
| inspector Runs tab | 13 | 13/13 |

## Linux execution-engine probes (disposable container)

See `COMPILER_SECURITY_REVIEW.md` §3 — 11 probes × 3 identity modes, plus 4-language regression and uid
reuse in pool mode. Per-run uid mode blocks P2, P3, P7, P8 (`/etc`), P9, P11; **P6 (network) reachable in
all modes**.

## Scans

| Scan | Result |
|---|---|
| GET leak scan — 20 endpoints × 4 identities | Status codes match role lists; **0 bcrypt hashes / `password` fields**; only flag: a student's own user-agent in their own workspace |
| Secret scan — tracked files and full git history | No credentials; only documentation placeholders; `.env` never committed; legacy JWT value present in history (refused by code) |
| Dangerous sinks — `dangerouslySetInnerHTML`, `eval`, `new Function`, raw SQL | none in `src/` |
| Cookies set | none (CSRF N/A) |
| Password logging | none (errors logged contain at most bcrypt hashes) |
| `npm audit --omit=dev` | residual: `next` (fixed only in 15.5+), `dompurify` (via Monaco), `postcss` (build-time) |
| `tsc --noEmit` / `next build` | clean / compiles |

## Not tested (and why)

- Denial-of-service volumes (fork bombs, memory floods) — out of scope by instruction; limits verified with
  bounded probes instead.
- Anything against Railway or Vercel — no production testing.
- TLS / HSTS — terminated by the platforms; not verifiable from the repository.
- Railway-specific: whether user namespaces are available for a bubblewrap/nsjail sandbox.
