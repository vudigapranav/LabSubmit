# Production Dockerfile
FROM node:20-alpine AS base

# Build toolchain (node-pty needs to compile a native addon) + the language
# toolchains the execution engine shells out to at runtime (gcc, g++, javac/java).
RUN apk add --no-cache \
    build-base \
    python3 \
    bash \
    openjdk17-jdk \
    tini

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# Seccomp launcher for student programs: no network, no ptrace/mount/unshare/io_uring
# (src/lib/execution/sandbox-launcher.c). Built here; ENABLED only when the deployment sets
# EXEC_SANDBOX_LAUNCHER=/usr/local/bin/labsubmit-sandbox (see SECURITY_BLOCKER_CLOSURE_REPORT.md).
RUN gcc -O2 -Wall -o /usr/local/bin/labsubmit-sandbox src/lib/execution/sandbox-launcher.c

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# tini as PID 1 reaps orphaned processes. Without it, processes killed at the end of a student
# run were reparented to node (PID 1), which never reaps them, so zombies accumulated.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
