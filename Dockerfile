# syntax=docker/dockerfile:1

# Only `packages/cli` takes part in the image — `apps/desktop` is an Electron app
# and pulling its devDependencies in would add ~200 MB of build tooling that never
# ships. `packages/cli` is the whole of GreenTunnel: the engine lives in its
# `src/core`, so there is no second workspace to install.

FROM node:24-alpine AS build
WORKDIR /green-tunnel

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/cli/package.json packages/cli/
# The desktop manifest is copied but never installed: `npm ci` checks the whole
# workspace tree against the lockfile, so a missing member is an error even when
# it is not one of the `--workspace` targets.
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --include-workspace-root --workspace packages/cli

COPY packages ./packages
RUN npx tsc --build packages/cli/tsconfig.build.json

FROM node:24-alpine AS runtime
WORKDIR /green-tunnel

# Supplied by the publish workflow from the git tag. Nothing in the repository
# records a release number, so without this `gt --version` would report 0.0.0
# inside the image. Left at 0.0.0 for a plain local `docker build`, which is
# honest: that image is not a release.
ARG VERSION=0.0.0

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=8000 \
	DNS_MODE=doh \
	LOG_LEVEL=info

COPY package.json package-lock.json ./
COPY packages/cli/package.json packages/cli/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --omit=dev --include-workspace-root \
	--workspace packages/cli \
	&& npm cache clean --force

COPY --from=build /green-tunnel/packages/cli/dist packages/cli/dist

# After `npm ci`, deliberately: the committed lockfile records each workspace's
# version, and stamping before the install would make the two disagree.
RUN npm pkg set version="$VERSION" --workspace packages/cli

USER node
EXPOSE 8000/tcp

# `${VAR:+--flag}` rather than v2's `--flag "$VALUE"`: v3 parses arguments with
# node:util.parseArgs, where a boolean flag takes no value at all — `--https-only
# false` would be a usage error, not "off". Unset means off.
CMD node packages/cli/dist/main.js \
	--host "$HOST" \
	--port "$PORT" \
	--dns "$DNS_MODE" \
	--log-level "$LOG_LEVEL" \
	--no-system-proxy \
	${FRAGMENT_SIZE:+--fragment-size "$FRAGMENT_SIZE"} \
	${FRAGMENT_DELAY:+--fragment-delay "$FRAGMENT_DELAY"} \
	${DOH_URL:+--doh-url "$DOH_URL"} \
	${DOT_HOST:+--dot-host "$DOT_HOST"} \
	${DNS_SERVER:+--dns-server "$DNS_SERVER"} \
	${TLS_RECORDS:+--tls-records} \
	${NO_FRAGMENT:+--no-fragment} \
	${HTTPS_ONLY:+--https-only}
