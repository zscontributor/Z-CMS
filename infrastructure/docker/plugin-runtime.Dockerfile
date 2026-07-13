# plugin-runtime — executes untrusted marketplace plugins.
#
# isolated-vm is a native addon, so the build stage needs a toolchain. The
# runtime stage does not, and must not have one: a compiler in the container that
# runs third-party code is a gift to an attacker.

FROM node:24-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# `pnpm prune --prod` wipes and rebuilds node_modules, and pnpm refuses to remove a
# modules directory unattended unless it knows it is not talking to a human. Without
# this it aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY — in a Dockerfile,
# where there is never a TTY to ask.
ENV CI=true

WORKDIR /repo

COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
# Every workspace package plugin-runtime depends on, transitively. pnpm resolves
# `workspace:*` against what is on disk, so a dependency this image forgets to copy
# is not a missing file at runtime — it is an install that fails outright.
COPY packages/schemas ./packages/schemas
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/package ./packages/package
COPY apps/plugin-runtime ./apps/plugin-runtime

RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @zcmsorg/schemas build \
 && pnpm --filter @zcmsorg/package build \
 && pnpm --filter @zcmsorg/plugin-sdk build \
 && pnpm --filter @zcmsorg/plugin-runtime build \
 && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

# No compiler, no package manager, no shell utilities beyond the base image.
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/plugin-runtime/dist ./dist
COPY --from=build /repo/apps/plugin-runtime/node_modules ./node_modules
COPY --from=build /repo/packages ./packages

# Never root. Combined with read_only + cap_drop in compose, an attacker who
# breaks the isolate lands as an unprivileged user in a filesystem they cannot
# write to, holding no credentials.
USER node

ENV NODE_ENV=production
EXPOSE 4200

CMD ["node", "dist/main.js"]
