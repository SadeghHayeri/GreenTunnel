# syntax=docker/dockerfile:1

# Only `packages/core` and `packages/cli` take part in the image — `apps/desktop`
# is an Electron app and pulling its devDependencies in would add ~200 MB of
# build tooling that never ships.

FROM node:24-alpine AS build
WORKDIR /green-tunnel

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
# The desktop manifest is copied but never installed: `npm ci` checks the whole
# workspace tree against the lockfile, so a missing member is an error even when
# it is not one of the `--workspace` targets.
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --include-workspace-root \
	--workspace packages/core \
	--workspace packages/cli

COPY packages ./packages
RUN npx tsc --build packages/cli

FROM node:24-alpine AS runtime
WORKDIR /green-tunnel

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=8000 \
	DNS_MODE=doh \
	LOG_LEVEL=info

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --omit=dev --include-workspace-root \
	--workspace packages/core \
	--workspace packages/cli \
	&& npm cache clean --force

COPY --from=build /green-tunnel/packages/core/dist packages/core/dist
COPY --from=build /green-tunnel/packages/cli/dist packages/cli/dist

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
