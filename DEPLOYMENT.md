# LabSubmit — Deployment Guide (Vercel + Railway)

**Public URL you submit to the college: the Vercel one.**
Railway runs behind it and is never typed into a browser by a student or lecturer.

---

## 1. Why the app is split across two hosts

LabSubmit is one Next.js codebase, but it does two very different jobs, and only one of them can run on Vercel.

| Job                                                                         | Needs                                                                                  | Runs on     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------- |
| UI + REST API routes (login, labs, submissions, grading, admin)             | Database access only                                                                   | **Vercel**  |
| Execution engine (compile & run student C/C++/Java code in a live terminal) | Persistent WebSocket, `node-pty` native addon, `gcc`/`g++`/`javac`, writable temp disk | **Railway** |

Vercel runs Next.js as short-lived serverless functions. They cannot hold a WebSocket open, cannot load `node-pty`, and have no compilers installed. That is not a config problem — it is what serverless is. So the execution engine keeps living in the Docker container it already has, and Railway hosts it.

The browser talks to **both**: normal page loads and API calls go to Vercel; when a student presses **Run**, the terminal opens a `wss://` connection straight to Railway. Both hosts read and write the same Postgres database, which is also on Railway.

```
                    Student's browser
                     /              \
        HTTPS (pages, API)        WSS (Run button only)
             /                            \
      ┌─────────────┐                ┌──────────────────┐
      │   VERCEL    │                │     RAILWAY      │
      │ UI + API    │                │ server.js + ws   │
      │             │                │ node-pty, gcc,   │
      │             │                │ g++, javac       │
      └──────┬──────┘                └────────┬─────────┘
             │                                │
             └────────► Postgres ◄────────────┘
                    (Railway plugin)
```

---

## 2. Code changes already applied for you

You do not need to write these — they are already in the repo. Listed so you know what changed and can explain it if asked.

1. **`src/components/Terminal.tsx`** — the WebSocket URL was hardcoded to `window.location.host`, which on Vercel would point the terminal at Vercel (where there is no WebSocket server). It now reads `NEXT_PUBLIC_WS_URL` and falls back to same-origin, so local dev still works unchanged.
2. **`prisma/schema.prisma`** — `provider` changed from `sqlite` to `postgresql`. A SQLite file lives on one machine's disk; two hosts cannot share it over the network.
3. **`package.json`** — `node-pty` moved from `dependencies` to `optionalDependencies`, so the Vercel build does not fail trying to compile a native addon it will never use. `npm ci` inside the Dockerfile still installs it, because npm installs optional dependencies by default.
4. **`src/lib/execution/types.ts`** — `import { IPty }` changed to `import type { IPty }`. This file gets pulled into the Vercel build through `lib/compiler`; the type-only form is erased at compile time so Vercel never tries to resolve `node-pty` there.

**Run this once before you push**, so `package-lock.json` matches the new `package.json` (otherwise `npm ci` fails on both hosts):

```bash
cd /Users/pranav07vudiga/Desktop/Projects/LabSubmit
npm install
```

---

## 3. Push a clean repo to GitHub

Your current `.git` folder is ~365 MB and its history contains `.env` (with the old JWT secret in plaintext), `prisma/dev.db`, `node_modules`, and `.next`. `.gitignore` now excludes all of these, but old commits still hold them. Start the history fresh:

```bash
cd /Users/pranav07vudiga/Desktop/Projects/LabSubmit

rm -rf .git
git init
git branch -m main
git add .
git commit -m "LabSubmit platform"

git remote add origin https://github.com/vudigapranav/LabSubmit.git
git push -f origin main
```

Check `git status` before committing — `.env` and `prisma/dev.db` must **not** appear in the list of files to be added. If they do, `.gitignore` isn't being picked up; stop and fix that first.

---

## 4. Railway — database first

1. Go to **railway.app** → sign in with GitHub → **New Project**.
2. **+ New** → **Database** → **Add PostgreSQL**. Wait for it to provision.
3. Click the Postgres service → **Variables** tab → find **`DATABASE_URL`**. It looks like `postgresql://postgres:xxxx@xxxx.railway.internal:5432/railway`.
4. You also need the _public_ form of that URL for Vercel, because Vercel is outside Railway's private network. In the same Variables tab find **`DATABASE_PUBLIC_URL`** (its host ends in `.proxy.rlwy.net`). Copy that separately.

> Two URLs, two consumers: Railway's own service uses the internal `DATABASE_URL`; Vercel uses `DATABASE_PUBLIC_URL`. Mixing them up is the most common failure here — Vercel cannot resolve `.railway.internal` hostnames.

---

## 5. Railway — the execution engine

1. In the same project: **+ New** → **GitHub Repo** → select `vudigapranav/LabSubmit`. Railway detects the `Dockerfile` automatically.
2. Open the new service → **Variables** → add:

   | Variable       | Value                                                                            |
   | -------------- | -------------------------------------------------------------------------------- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — type it exactly like that; Railway substitutes it |
   | `JWT_SECRET`   | the value from your local `.env` — **the same string you will put in Vercel**    |
   | `NODE_ENV`     | `production`                                                                     |
   | `PORT`         | `3000`                                                                           |

3. **Settings** → **Networking** → **Generate Domain**. You get something like `labsubmit-production.up.railway.app`. Copy it.
4. Wait for the build to go green. The first build takes ~5 minutes — it compiles `node-pty` and installs JDK 17.
5. Open the service's shell (**⋮** → **Shell**) and initialise the database:

   ```bash
   npx prisma db push
   npm run db:seed
   ```

   Run this **once**. `db:seed` creates the admin account and demo data; running it twice may create duplicates.

You do **not** need a Railway volume any more — Postgres holds all the data, and the container only writes throwaway compile artifacts to `/tmp`.

---

## 6. Vercel — the public site

1. **vercel.com** → **Add New** → **Project** → import `vudigapranav/LabSubmit`.
2. Framework preset: **Next.js**. Leave build and output settings at their defaults — `npm run build` already runs `prisma generate` first, which Vercel requires.
3. Before clicking Deploy, expand **Environment Variables** and add all four:

   | Variable             | Value                                                                                                                          |
   | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`       | the **`DATABASE_PUBLIC_URL`** from step 4 (the `.proxy.rlwy.net` one)                                                          |
   | `JWT_SECRET`         | **byte-for-byte identical** to the Railway value                                                                               |
   | `NEXT_PUBLIC_WS_URL` | `wss://labsubmit-production.up.railway.app/api/ws` — your Railway domain, `wss://` not `https://`, and keep the `/api/ws` path |
   | `NODE_ENV`           | `production`                                                                                                                   |

4. **Deploy.** You get `https://labsubmit.vercel.app` (or `labsubmit-<hash>.vercel.app`).

If `JWT_SECRET` differs between the two hosts, students will log in fine but every **Run** will fail with an auth error — the token Vercel issues won't verify on Railway. Copy-paste it; don't retype it.

### Getting a cleaner Vercel URL

Vercel **Settings → Domains** lets you rename the project subdomain for free. `labsubmit.vercel.app` reads far better on a proposal than `labsubmit-git-main-vudigapranav.vercel.app`. Do this before you submit, if the name is available.

---

## 7. Verify before you submit

Work through this in order — each step depends on the one above it.

1. Open the Vercel URL. The login page renders → Vercel build is good.
2. Log in as `admin@cbit.in` / `admin@123` → Vercel can reach Postgres.
3. **Change that password immediately.** It is in the seed script, which is in a public GitHub repo.
4. Admin dashboard shows the seeded students → database reads work.
5. Log in as a student, open a lab, press **Run** on the boilerplate `main.c`.
   - Terminal prints `Welcome to CBIT Programming Exam!` → the whole chain works. **You're done.**
   - Terminal shows nothing / "connecting": open browser DevTools → Console. `WebSocket connection to 'wss://...' failed` means `NEXT_PUBLIC_WS_URL` is wrong, or the Railway service is asleep or crashed.
   - Terminal prints an auth error: `JWT_SECRET` doesn't match between the two hosts.
6. Submit the lab, then log in as the lecturer and confirm the submission appears → writes are landing in the shared database.

---

## 8. Known limits of this setup, stated honestly

Worth knowing in case the review committee asks — and worth putting in your own words rather than hiding.

- **Free-tier sleep.** Railway's trial plan sleeps inactive services. The first **Run** after an idle period takes ~30 seconds to wake. On a paid Hobby plan (~$5/mo) it stays warm. Do not run a live lab session on the sleeping free tier.
- **No sandbox isolation between students.** Submitted code compiles and runs as a normal process inside one shared container. There is no per-student jail, CPU quota, or memory cap, so one student's infinite loop can degrade the container for everyone in that session. Acceptable for a supervised pilot; needs per-execution containers or a resource-limited runner before it is exposed to a full department. This is the most important thing to be upfront about.
- **Cross-origin WebSocket.** Auth for the terminal travels as a token inside the WebSocket message payload rather than as a cookie — which is exactly what makes the Vercel→Railway split work. It also means the token is only as safe as the client holding it.
- **Vendor free tiers are not an institutional SLA.** Neither Vercel Hobby nor Railway's trial carries an uptime guarantee, and Vercel's Hobby tier is licensed for non-commercial use. Fine for a pilot; for graded assessments the college depends on, budget for paid plans — see the Budget section of the proposal.

---

## 9. Single-host alternative (fallback)

If the split gives you trouble and the deadline is close: deploy **only** to Railway. The Dockerfile runs the entire app — UI, API, and execution engine — on one host, `NEXT_PUBLIC_WS_URL` stays unset so the same-origin fallback kicks in, and everything works exactly as it does on your machine. You lose the `.vercel.app` URL and submit the `.up.railway.app` one instead. Keep this in your back pocket.
