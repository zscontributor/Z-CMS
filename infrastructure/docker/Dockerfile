# syntax=docker/dockerfile:1
#
# One Dockerfile, many targets. Every first-party service is built from the same
# monorepo install + build, then split into a lean runtime stage selected with
# `--target`. Sharing the install/build layers means one `pnpm install` and one
# `pnpm build` are cached and reused across all of them.
#
#   docker build --target cms-api      -t zcms/cms-api      .
#   docker build --target worker       -t zcms/worker       .
#   docker build --target admin-web    -t zcms/admin-web    .
#   docker build --target site-runtime -t zcms/site-runtime .
#   docker build --target migrate      -t zcms/migrate      .
#
# plugin-runtime is deliberately NOT here — it executes untrusted code and gets
# its own minimal, credential-free image (plugin-runtime.Dockerfile). Folding it
# into this shared build would ship it every other service's dependencies.
#
# Build context is the repo root: `docker build -f infrastructure/docker/Dockerfile .`

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
# base — pnpm via corepack, nothing else. Shared by build and runtime stages.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Non-interactive: pnpm refuses to prune a modules dir without a TTY unless CI is set.
ENV CI=true
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# build — install (with a native toolchain for isolated-vm/sharp) and build the
# whole workspace once. NODE_ENV stays unset here: the build needs devDeps
# (nest cli, tsc, next), and setting it to production would drop them.
# ---------------------------------------------------------------------------
FROM base AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy the whole repo. .dockerignore keeps node_modules/dist/.next/.env out, so
# the install is driven purely by the committed lockfile — reproducible.
COPY . .

RUN pnpm install --frozen-lockfile
# `prisma generate` resolves DATABASE_URL from prisma.config.ts even though it
# never connects. .env is (rightly) not in the image, so hand the build a throwaway
# value inline — it is scoped to this RUN and never persists into any image layer.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" pnpm build

# ---------------------------------------------------------------------------
# prod-deps — the same tree with devDependencies pruned out. The Node services
# copy their node_modules from here; the built workspace dist under packages/*
# survives (prune only touches node_modules).
# ---------------------------------------------------------------------------
FROM build AS prod-deps
RUN pnpm prune --prod

# ===========================================================================
# cms-api — the NestJS API. Preserves the /repo layout so pnpm's node_modules
# symlinks into packages/* still resolve at runtime.
# ===========================================================================
FROM base AS cms-api
LABEL org.opencontainers.image.source="https://github.com/zscontributor/z-cms"
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/packages ./packages
COPY --from=prod-deps /repo/apps/cms-api/node_modules ./apps/cms-api/node_modules
COPY --from=build /repo/apps/cms-api/dist ./apps/cms-api/dist
COPY --from=build /repo/apps/cms-api/package.json ./apps/cms-api/package.json
USER node
ENV CMS_API_PORT=4100
EXPOSE 4100
# The API answers GET /api/v1/health once it is listening; compose/k8s probe it.
CMD ["node", "apps/cms-api/dist/main.js"]

# ===========================================================================
# worker — the BullMQ background process. No inbound port; it dials Redis.
# sharp is a prod dependency, so its native binary is already in node_modules.
# ===========================================================================
FROM base AS worker
LABEL org.opencontainers.image.source="https://github.com/zscontributor/z-cms"
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/packages ./packages
COPY --from=prod-deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json
USER node
CMD ["node", "apps/worker/dist/main.js"]

# ===========================================================================
# migrate — a one-shot job: apply committed migrations, then exit. Built FROM
# `build` because it needs the prisma CLI (a devDependency) and the compiled
# @zcmsorg/database. Run it once per deploy, before the app services start.
#
# Seeding (the first admin, demo plugins) is NOT here: it is a one-time
# bootstrap, not something to re-run on every rollout. Seed by hand once:
#   docker run --rm --env-file .env zcms/migrate pnpm --filter @zcmsorg/database seed
# ===========================================================================
FROM build AS migrate
LABEL org.opencontainers.image.source="https://github.com/zscontributor/z-cms"
ENV NODE_ENV=production
WORKDIR /repo
# `prisma migrate deploy` — applies pending migrations, never generates or resets.
CMD ["pnpm", "--filter", "@zcmsorg/database", "migrate"]

# ===========================================================================
# Next.js apps run from their traced standalone output (next.config sets
# output: "standalone"). The standalone bundle is self-contained — its own
# minimal node_modules and a server.js — so these stages carry no pnpm store and
# no workspace symlinks. `static/` and `public/` are copied alongside because
# standalone does not include them. Because outputFileTracingRoot is the repo
# root, the bundle is laid out as apps/<name>/server.js under the trace root.
# ===========================================================================

# --------------------------- admin-web (port 3001) -------------------------
FROM base AS admin-web
LABEL org.opencontainers.image.source="https://github.com/zscontributor/z-cms"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/admin-web/.next/standalone ./
COPY --from=build /repo/apps/admin-web/.next/static ./apps/admin-web/.next/static
COPY --from=build /repo/apps/admin-web/public ./apps/admin-web/public
USER node
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
EXPOSE 3001
CMD ["node", "apps/admin-web/server.js"]

# ------------------------- site-runtime (port 3000) ------------------------
FROM base AS site-runtime
LABEL org.opencontainers.image.source="https://github.com/zscontributor/z-cms"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/site-runtime/.next/standalone ./
COPY --from=build /repo/apps/site-runtime/.next/static ./apps/site-runtime/.next/static
COPY --from=build /repo/apps/site-runtime/public ./apps/site-runtime/public
USER node
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/site-runtime/server.js"]
