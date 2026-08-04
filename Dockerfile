# Production Dockerfile
FROM node:20-alpine AS base

# Build toolchain (node-pty needs to compile a native addon) + the language
# toolchains the execution engine shells out to at runtime (gcc, g++, javac/java).
RUN apk add --no-cache \
    build-base \
    python3 \
    bash \
    openjdk17-jdk

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["npm", "start"]
