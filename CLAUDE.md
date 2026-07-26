# GreenTunnel v3

Ground-up TypeScript rewrite of GreenTunnel: a local proxy that bypasses DPI
censorship by splitting the TLS ClientHello so the SNI never appears whole in a
single packet, and by resolving hostnames over encrypted DNS.

v3 reuses v2's _techniques_, not its code. v3 **is** the repository now — it was
developed in a `v3/` subdirectory and promoted to the root, replacing v2's
`src/`, `bin/` and `gui/`. Those are gone from the working tree; read them at the
`v2.0.3` tag (`git show v2.0.3:src/proxy.js`) and treat them as reference
material, not as something to keep in sync.

**Status: working base.** The engine, CLI and desktop app all build, pass lint
and tests, and have been exercised end-to-end. Features and packaging are the
next phase — see [Roadmap](#roadmap).

## Commands

Run everything from the repository root.

```bash
npm install            # workspaces: packages/*, apps/*

npm run build          # tsc --build (cli) + electron-vite build (desktop)
npm run typecheck      # all three TS projects
npm run lint           # eslint, type-aware
npm test               # vitest
npm run check          # typecheck + lint + test

npm run dev            # electron-vite dev — the desktop app, with HMR
npm run dev:cli        # build the CLI and run it

npm run clean          # drop dist/, out/, release/, build info
```

Per package:

```bash
npm run build --workspace packages/cli           # the engine and the CLI
npm run package --workspace apps/desktop         # electron-builder, current OS
npm run package:mac --workspace apps/desktop     # or :win / :linux
```

### Running the CLI

```bash
node packages/cli/dist/main.js --help
node packages/cli/dist/main.js --port 8080 --no-system-proxy
```

### ⚠️ `npm run dev` changes your real system proxy

Default settings are `startOnLaunch: true` + `manageSystemProxy: true`, so
launching the app points macOS/Windows/GNOME at it. For iterating on UI or
main-process code, use a throwaway profile instead:

```bash
mkdir -p /tmp/gt-profile
cat > /tmp/gt-profile/settings.json <<'JSON'
{ "startOnLaunch": false, "manageSystemProxy": false, "launchAtLogin": false,
  "port": 18500, "dnsMode": "doh", "fragmentSize": 40, "tlsRecords": false }
JSON
npm run build --workspace apps/desktop
./node_modules/.bin/electron apps/desktop --user-data-dir=/tmp/gt-profile
```

Add `--remote-debugging-port=9333` and `curl -s localhost:9333/json/list` to
confirm the renderer loaded without needing to look at the screen.

## Layout

```
├── packages/cli/      green-tunnel — the **only** published package: the engine
│                      (src/core) plus the `gt` binary
├── apps/desktop/      green-tunnel-desktop — Electron 43, private, never published
├── assets/            README artwork (logo, demo gif, screenshot)
├── Dockerfile         two-stage; packages/cli only, never apps/desktop
└── .github/workflows/ test.yml (every push) · publish.yml (v* tags)
```

### `packages/cli/src/core` — the engine

Its own package (`@green-tunnel/core`) for exactly one release cycle, and never
published under that name. See
[One package, not two](#one-package-not-two-and-why) for why it was folded back
in. Nothing in here may import from outside it — ESLint enforces that, since a
directory cannot.

```
src/core/
├── index.ts             public API surface
├── types.ts             every settings/event/stat type
├── config.ts            defaults + resolveSettings + assertValidSettings
├── errors.ts            typed errors (DnsError, ConnectError, …)
├── logger.ts            levelled, scoped, pluggable sink (replaces `debug`)
├── proxy/
│   ├── index.ts         Proxy — EventEmitter, start/stop, stats
│   ├── connection.ts    read the first head, route CONNECT vs plain
│   ├── connect-tunnel.ts  HTTPS: fragment the ClientHello  ← the whole point
│   ├── plain-tunnel.ts  HTTP: relay + rewrite request heads
│   ├── pipe.ts          bidirectional pipeline with teardown
│   └── context.ts       per-connection dependency bundle
├── tls/fragment.ts      ClientHello detection + the two split strategies
├── http/
│   ├── head.ts          request-line/header parse, origin-form, authority
│   └── rewriter.ts      framing-aware keep-alive head rewriter
├── dns/
│   ├── resolver.ts      TTL cache + family preference + in-flight dedupe
│   ├── doh.ts  dot.ts  plain.ts  decode.ts
├── net/socket.ts        connect with timeout, backpressure-aware write
└── system-proxy/        darwin.ts linux.ts windows.ts + snapshot/restore
                        recovery.ts — snapshot persisted to disk so a killed
                        process's proxy can still be undone next launch
```

The four files beside it are the CLI proper, and are the only things in the
package the engine may **not** reach:

```
src/
├── index.ts    library surface — re-exports src/core wholesale, plus VERSION
├── main.ts     the `gt` binary: parse, run, handle signals
├── options.ts  parseArgs → ProxyOptions, HELP_TEXT, UsageError
├── ui.ts       the banner and status output
└── version.ts  read once, at build time
```

### `apps/desktop`

```
src/
├── main/       index.ts (wiring) · tunnel-service.ts (owns engine + OS proxy)
│               window.ts · tray.ts · ipc.ts · settings.ts · json-store.ts
│               log-buffer.ts (the ring) · logs-window.ts (the second window)
│               advocacy.ts (when to ask for a star, and whether to again)
├── preload/    the only bridge — one API object, shared by both pages
├── renderer/   vanilla TS + Vite, no framework. Two pages: index.html (the
│               column) and logs.html (the log panel). advocacy.ts holds the
│               two <dialog> sheets: share, and the star prompt
└── shared/     types.ts + ipc.ts + share.ts, imported by all three
```

## Architecture

```
browser → CONNECT host:443 → Proxy
                              ├ dns.resolve(host)      DoH / DoT / plain, TTL-cached
                              ├ net.connect(ip:443)    with timeout
                              ├ 200 Connection Established
                              ├ fragmentClientHello()  ← DPI evasion happens here
                              └ pipeline() both ways
```

Two deliberate separations, both different from v2:

- **`Proxy` never touches the OS proxy.** `SystemProxy` is independent, so the
  engine is testable without root and a crashed engine cannot strand the machine
  pointed at a dead port. The CLI and `TunnelService` compose the two.
- **`TunnelService` owns all desktop state** and publishes one immutable
  `AppState`. Tray and window both render from it; nothing is hand-synced.

## Conventions

- **Native ESM.** Relative imports carry a **`.js`** extension even in `.ts`
  files — the standard TS-ESM convention (`./types.js` resolves `types.ts`).
- **`#private` fields**, not `private`. `erasableSyntaxOnly` is on, so no enums,
  no namespaces, no parameter properties.
- Strict everything: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`. Index-signature reads use
  `input['key']`, not `input.key`.
- Errors are **thrown**, not logged-and-swallowed. That was v2's defining bug.
- Comments explain _why_, especially where the code corrects a v2 mistake.

## Pinned versions, and why

| What       | Version          | Why not newer                                                                                                                          |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Electron   | 43.2.0 (exact)   | Latest stable. Electron has **no LTS channel** — it supports the newest 3 majors. Bundles Node 24. **No caret**, see below.            |
| Node       | 24 LTS (Krypton) | `engines: >=24`. Node 26 is Current, not LTS until Oct 2026.                                                                           |
| TypeScript | 6.0.3            | 7.0.2 is out (native port) but `typescript-eslint@8.65` peers `>=4.8.4 <6.1.0`. **Revisit when typescript-eslint ships TS 7 support.** |
| Vite       | 7.3.6            | Vite 8 is out but `electron-vite@5` peers `^5 \|\| ^6 \|\| ^7`.                                                                        |

Electron's version is written **`"43.2.0"`, not `"^43.2.0"`**, and that is not a
style preference. electron-builder downloads a platform-specific binary for one
exact release, so it refuses a range outright — `Electron version "^43.2.0" is a
range, not a fixed version`. It can fall back to reading the installed version
out of `node_modules`, but not here: npm hoists `electron` to the **workspace
root**, and electron-builder only looks under `apps/desktop`. So the range never
resolved and packaging failed before it started. Keep the caret off.

Runtime dependencies are deliberately tiny: `green-tunnel` needs only
`dns-packet` and `lru-cache` (both for the engine), and the desktop app has
**zero** — it bundles. A clean `npm i green-tunnel` installs four packages
including transitives. `parseArgs`,
`styleText`, `dns.Resolver` and `fetch` come from Node itself, replacing v2's
`yargs`, `chalk`, `clear`, `ora`, `debug`, `dns-socket`, `dns-over-tls`,
`validator` and `winreg`.

## Electron specifics

- Package is `"type": "module"`; **main runs as ESM**.
- **Preload must be CommonJS** — `sandbox: true` forbids ESM preloads. It is
  built to `out/preload/index.cjs` via `output.format: 'cjs'`. Do not "fix" this.
- The renderer is fully locked down: `sandbox`, `contextIsolation`,
  `nodeIntegration: false`, a CSP meta tag, navigation blocked, and
  `shell.openExternal` restricted to an origin allowlist.
- `apps/desktop` declares **no runtime `dependencies`** — the engine and its deps
  are bundled into `out/main/index.js` (172 kB). That keeps electron-builder away
  from workspace symlinks entirely, and it is why the packaged `.app` contains no
  `node_modules` at all. The import is `from 'green-tunnel'`, the workspace
  package: only its `src/index.ts` is reachable that way and that file does not
  import `main.ts`, so none of the terminal code comes along.
- `resources/` ships outside the asar (`extraResources`) so
  `nativeImage.createFromPath` finds the `@2x` tray variants.
- Tray menu items use `click`, never `role` — a `role` makes Electron ignore
  `click`, which would skip the system-proxy restore on quit.
- **A sandboxed preload cannot read `process`, in either spelling.** A bare
  `process` is rewritten by Vite into `require("node:process")`, which collides
  with the binding the sandbox already injects ("Identifier 'process' has
  already been declared"); `globalThis.process` is `undefined`, because that
  binding is scoped to the preload wrapper and not to the global object. Either
  way the preload throws **before** `exposeInMainWorld`, so `window.greenTunnel`
  is undefined and every page dies on its first call — with the only clue in the
  renderer console, not on stderr. Facts the main process knows go into the
  window's URL instead (`logs.html?platform=darwin`).
- **`window.close()` is ignored for a window the page did not open.** Chromium's
  rule, and it applies to a `BrowserWindow` the main process created: the call is
  a silent no-op, and because no `close` event fires, anything hanging off it —
  such as saving the window's bounds — never runs either. Route it through IPC
  (`IPC.closeLogs`).

## The log panel

`main/log-buffer.ts` is a bounded ring (5000 entries) wired up as the engine
logger's sink. It is deliberately **independent of the engine**: changing an
engine setting restarts the `Proxy`, and history that vanished with it would
lose exactly the lines that explain why the user was changing the setting.
Records are flushed to the window in ~120 ms batches, so a trace-level flood is
not one IPC message per line, and are dropped entirely while it is closed.

`logLevel` is an `AppSettings` field, so it survives a restart, but it is **not**
in `affectsEngine` — `applySettings` calls `logger.setLevel` instead, which is
why turning the level up mid-session never drops a live connection. That works
only because `Logger` shares one mutable state object with its children; copying
the level into `child()` (as v3.0 did) leaves a child stuck at whatever the level
was when it was created.

The page (`renderer/logs.html` + `src/logs.ts`) is a **virtual list**: only the
rows in view exist in the DOM — 1600 lines rendered 31 elements — and a row's
position is `index × 18px`. That arithmetic is exact only while every row is the
same height, so **nothing in the list may wrap**: long lines scroll sideways, and
an error's stack is flattened into one row per frame at model-build time rather
than growing the row it belongs to. `--row` in logs.css and `ROW_HEIGHT` in
logs.ts are the same number and must stay that way.

## The window is sized by its content

The desktop window is v2's: a 340 px-wide frameless column, dark only, with the
tunnel mark inside a circular power button. Everything beyond the on/off switch
lives behind the **Advanced** disclosure at the bottom.

Its height is never persisted and never set by hand. The renderer measures
`#app` with a `ResizeObserver` and calls `resizeContent(px)`; `setContentHeight`
in `main/window.ts` animates the window to it. That one rule covers the advanced
panel, an error message appearing, and anything else that reflows.

The advanced panel is **the last element in the document**, and that is load
bearing. Nothing in the page animates a height — the window's bottom edge is the
only clip, so growing the window _is_ the reveal, and shrinking it is the
reverse. Animate the panel's height as well and the two curves disagree for a
few frames, which tears the bottom row. Opening therefore un-hides the panel and
lets the observer do the rest; closing asks for the collapsed height **first**
and unmounts the panel only after the animation, or a void opens under the note.

`WindowState` holds `{ x, y, advancedOpen }` — no size. `advancedOpen` is UI
chrome, deliberately not an `AppSettings` field: writing a setting restarts the
tunnel, and a disclosure triangle must not drop live connections. For the same
reason `TunnelService.applySettings` restarts only when a key the engine
actually reads has changed (`affectsEngine`), so "Launch at login" is free.

The panel starts **closed** on a fresh install, and the user's own choice is
persisted to `window-state.json` and restored at boot — both directions, so
closing it sticks too. The default is `DEFAULT_UI_STATE` in `shared/types.ts`,
shared by `DEFAULT_WINDOW_STATE` and the renderer rather than spelled out in
each: the renderer's copy is what the page is laid out against for the moment
before `getUiState()` resolves, so a disagreement between the two would show as
a panel that flickers open, or a first frame measured at the wrong height.

## Asking for a star, without becoming nagware

Two popups, both `<dialog>` + `showModal()`: **Share Green Tunnel** (X, Telegram,
WhatsApp), reachable any time from the `Share ↗` link at the foot of the advanced
panel, and the **"Enjoying Green Tunnel?"** prompt that appears on its own.

They are dialogs and not cards in the column _because_ of the rule above. A
modal renders in the top layer, so it is out of flow and never enters the height
`#app` is measured at — a sheet laid out in the column would move the window's
bottom edge, which is the one thing that must only ever mean "the panel is
opening". The Escape handler in `renderer/src/main.ts` stands down while a sheet
is open, or one key press would close the sheet _and_ hide the window behind it.

The schedule lives in `main/advocacy.ts` and is stored in `advocacy.json` beside
the settings:

- Three asks, ever. The delays are **relative to the previous one** — 3 days,
  then 27, then 60 — which lands on day 3 / day 30 / day 90 for a regular user.
  Absolute deadlines were the obvious spelling and the wrong one: someone who
  installs the app and first opens it three months later would have all three
  come due at once and get every prompt inside a single week.
- **Star or Share retires it permanently** (`helped`), as does "Don't show
  again" (`dismissed`). "Later" only spends the current slot.
- The slot is spent when the prompt is _shown_, not when it is scheduled, so a
  window hidden inside the 2.5 s settle keeps its chance.
- `createAdvocacyStore` writes the file on first launch. It has to:
  `firstRunAt` defaults to _now_, so without that write it would be "now" again
  on every launch and the first prompt would never come due.

Share copy and the three target URLs are in `shared/share.ts`, and
`ALLOWED_EXTERNAL_ORIGINS` is built from them — a target added there cannot
silently fail to open, which is what `openExternal` would otherwise do. Keep the
message under ~250 characters: X counts the link as 23 whatever its length.

## One package, not two — and why

v3 was built as `@green-tunnel/core` + `green-tunnel`, and that split was undone
before either shipped. The engine now lives at `packages/cli/src/core` and
`green-tunnel` is the only published package.

The reason is that the split was never load bearing. `apps/desktop` already
treated the engine as an internal module — it depended on it as a **devDependency**
and bundled it, so it never needed a registry package. And `packages/cli/src/index.ts`
was nothing but `export * from '@green-tunnel/core'`, so library users already got
the whole engine from `green-tunnel`, the name v2 published under for ten years.
Publishing core separately was a second distribution channel for identical code,
pinned to the same version, gated on owning an npm **organisation** that did not
exist — which is exactly what broke the v3.0.0 release (see
[Release and distribution](#release-and-distribution)).

What the merge deleted: an npm org to create and hold, an exact-version dependency
edge between two packages, a publish-ordering constraint, a two-version tag check,
one of three tsconfigs, and six of the Dockerfile's thirteen workspace lines.

What it cost: the engine/CLI boundary was structural — a separate package simply
_could not_ import the CLI — and a directory guarantees nothing. So it is enforced
by ESLint instead, a `no-restricted-imports` block over `packages/cli/src/core/**`
that forbids the four CLI files by name. If you add a fifth file beside `main.ts`,
add it to that list. `npm run lint` is in `npm run check`, so it is not optional.

### Two tsconfigs in `packages/cli`

This split moved with the engine rather than disappearing, because the problem it
solves did: the build must not emit `*.test.ts` into `dist/`, but excluding tests
outright leaves them in no project at all and ESLint's type-aware rules fail with
"not found by the project service". So `packages/cli/tsconfig.json` is the
editor/ESLint view (includes tests, `noEmit`) and `tsconfig.build.json` is what
emits `dist/`. The root project reference points at **`tsconfig.build.json`**, and
so must `tsc --build` anywhere it is spelled out — the workflows and the Dockerfile
all say `packages/cli/tsconfig.build.json`.

`tsBuildInfoFile` sits **outside** `dist/`, because `files: ["dist"]` would
otherwise publish 42 kB of incremental-build metadata to npm.

## v2 bugs fixed here

Worth knowing about, because most are easy to reintroduce:

1. `BaseDNS.lookup` caught every error and returned `undefined`; the socket layer
   passed that to `net.connect`, silently **dialling localhost**.
2. `createConnection` never rejected — a refused or black-holed upstream hung the
   client socket forever. No timeout anywhere.
3. `write()` return values ignored: **no backpressure**, unbounded buffering.
4. The HTTP handler re-parsed _every_ chunk as a request, so any body starting
   with a method-like word (or any binary upload) was **corrupted**. v3 tracks
   `Content-Length`/chunked framing instead. Covered by `rewriter.test.ts`.
5. `HTTPResponse`'s constructor called `this._parseRequest`, which did not
   exist — it threw whenever it was given raw data. Plus `statusMessgae`.
6. `bufferToChunks` re-framed TLS records **and then** chopped the result by
   `chunkSize`, cutting records at arbitrary boundaries; trailing coalesced
   records were mangled.
7. Fragmentation was applied to the first packet whatever it was, breaking
   non-TLS CONNECT tunnels. v3 checks for a real ClientHello.
8. DNS cache ignored record TTLs and never expired; `cacheSize` was read from
   the global config, not the instance.
9. DoH spoke the Cloudflare/Google **JSON** API, so most DoH servers failed.
   v3 uses RFC 8484 wire format.
10. `dns-socket` kept one module-level socket forever and read `answers[0].data`
    unguarded → crash on an empty answer.
11. macOS system proxy only touched the one service on the default route, and
    interpolated its name into `sh -c "..."`. v3 uses `execFile` argument arrays
    across every enabled service.
12. `unsetProxy` blanket-disabled the proxy instead of restoring what was there,
    wiping any pre-existing corporate/dev proxy. v3 snapshots first.
13. The GUI ran `nodeIntegration: true` with `contextIsolation: false`.
14. The CLI logged `uncaughtException` and carried on with a half-dead proxy
    while the OS still pointed at it.

## v3.0 bugs fixed in v3.0.1 — the "stranded proxy" class

These are the ones that actually bricked a real machine's networking, and every
one is easy to reintroduce. The failure mode is nasty because it is _invisible_:
macOS publishes only the **highest-ranked active** service's proxy config to
`State:/Network/Global/Proxies`, which is what every app reads. A leftover proxy
on an unplugged dongle sits dormant, then captures all traffic the moment that
dongle reappears — while System Settings → Wi-Fi → Proxies looks perfectly
clean, because the stale setting lives on a different service. It looks exactly
like "the internet is broken", and a reboot appears to fix it only because the
interface comes back down.

1. **`snapshot()` and `apply()` enumerated the network services separately.** Any
   service appearing between the two calls — a USB-C ethernet dongle, an iPhone
   tether, a VPN connecting — got proxied with **no snapshot entry**, so
   `restore()` never touched it. Permanent. Fixed by making `apply` take the
   snapshot and touch exactly its targets, so the two sets are identical by
   construction. **Never re-enumerate inside `apply` or `restore`.**
2. **The damage was self-perpetuating.** A stranded `127.0.0.1:<port>` was
   snapshotted by the _next_ run as the user's original proxy and dutifully
   restored on exit, forever. `disown()` in `system-proxy/index.ts` now rewrites
   any entry pointing at loopback on the port we are about to bind into "was
   off".
3. **`restore()` aborted on the first failure.** A plain `for … await` loop threw
   on the first service that refused a write — macOS lists VPN services that do
   — abandoning every service after it. `settle()` now attempts all of them and
   reports the failures together.
4. **The bypass list was applied and never restored,** so GreenTunnel's
   `localhost 127.0.0.1 ::1 *.local` got burned into all ten services
   permanently. Snapshots now record it; restore puts it back (`Empty` clears).
5. **HTTP and HTTPS were snapshotted as one reading.** Only `-getwebproxy` was
   read and mirrored to both on restore, clobbering any service configured with
   just one of the two. Entries now carry a separate `secure` endpoint.
6. **No crash-safety whatsoever.** `SIGKILL`, a force-quit or a `npm run dev`
   reload left the proxy set with nothing recording what had changed, so no later
   run could fix it. `enable()` now persists the snapshot _before_ touching the
   OS, and `recoverSystemProxy()` — called at startup by both the CLI and the
   desktop app — undoes an orphan left by a dead PID. The file is only deleted
   after a _successful_ restore, so a failed one is retried next launch.
7. **CLI: `process.once` for signals.** A second Ctrl-C while "restoring…" was on
   screen hit Node's default SIGINT action and killed the process mid-restore.
   Signals now use `process.on` and absorb repeats. `SIGHUP` — closing the
   terminal — was not handled at all.
8. **Desktop: Electron does not turn a signal into `before-quit`.** It just dies,
   so `npm run dev` reloads and `kill` skipped teardown entirely. Signals are now
   routed through `app.quit()`. Teardown also has a 15 s timeout so a wedged
   `networksetup` cannot block quit forever.

## Verified

Actually run, not assumed:

- `tsc --build`, desktop `typecheck`, `eslint`, `vitest` (33 tests) — all clean.
- `electron-vite build` — main/preload/renderer all emit.
- Proxied `curl` through the CLI: HTTPS CONNECT, a second HTTPS host, plain
  HTTP absolute-form rewrite, a POST whose body begins `GET http://…` (intact),
  and `--https-only` returning 403 for plain HTTP.
- Fragmentation: `--tls-records`, TCP split with `--fragment-delay`, and
  `--no-fragment`.
- DNS: DoH against Cloudflare / Google / AdGuard, DoT against 1.1.1.1 / 8.8.8.8
  / 9.9.9.9, plain against system resolvers and 8.8.8.8.
- Electron boots and the renderer loads (checked over the DevTools protocol).
- **The window**, screenshotted over the DevTools protocol in every state: off,
  connecting (spinner arc), on, and a forced `EACCES` failure. The advanced
  panel opens, closes, survives a relaunch, and clips cleanly against the window
  edge mid-collapse with no void. `curl` through the running app returned 200
  over both HTTPS CONNECT and plain HTTP. Toggling `startOnLaunch` left
  `stats.startedAt` untouched; changing `fragmentSize` restarted the tunnel.
- **`SystemProxy` on macOS**, against real `networksetup` across ten services
  (Wi-Fi, two USB-C ethernet dongles, Thunderbolt Bridge, three iPhone-USB
  services, Tailscale, V2BOX, Shadowrocket):
  - full enable/disable cycle restores every service;
  - `SIGINT`, `SIGTERM`, `SIGHUP` and a triple-`SIGINT` all tear down cleanly;
  - `kill -9` strands the proxy, and the **next run detects and undoes it**;
  - a seeded corporate config (HTTP on `10.0.0.9:3128`, HTTPS recorded but
    switched off on `:3129`, bypass `*.corp internal.example`) comes back
    byte-for-byte after a full cycle;
  - SOCKS is never written, so another local proxy's config survives untouched.
- **The log panel**, driven over the DevTools protocol against a real run with
  3000 connections pushed through the proxy:
  - 1601 lines rendered **31 DOM rows**, canvas height exactly `lines × 18`;
  - tailing follows new lines, and scrolling up raises "Jump to latest";
  - filtering (`1,200 of 1,601 lines`), no-match and cleared empty states;
  - Copy put correctly formatted lines on the clipboard;
  - overflow past the ring keeps the last 5000 entries and says so;
  - at 520 px wide every row is still 18 px and the long lines scroll sideways;
  - the level change wrote `settings.json`, took effect immediately, and left
    `stats.startedAt` untouched — no restart. `Off` captured nothing at all;
  - history survived an engine restart (`fragmentSize`), which logged
    `settings changed; restarting the tunnel` / `stopped` / `listening on …`;
  - Escape closes the window, and its bounds come back exactly on reopen.

- **`electron-builder` on macOS**, run locally with
  `CSC_IDENTITY_AUTO_DISCOVERY=false`: `GreenTunnel-3.0.0{,-arm64}.dmg` and the
  two matching `-mac.zip`s all build, and the asar carries `out/main/index.js`,
  `out/preload/index.cjs` and the renderer, with `resources/` correctly left
  outside it. Unsigned — that is what CI produces too.
- **Both workflows**, on the `v3.0.0` tag push. `hadolint`, the real Docker build
  and `curl` through the container all passed, as did the multi-arch Docker Hub
  push and the tag/version `verify` job. The `npm ci --workspace …` filtering in
  the image was fine. What failed is
  [recorded in full](#what-the-v300-tag-taught-us-in-one-place).
- **The published package, from its own tarball.** `npm pack` → install into an
  empty directory → run the installed binary. 133 files, 64.5 kB, and the only
  things npm pulled were `dns-packet`, `lru-cache` and one transitive: no
  `@green-tunnel/core` to resolve, and no `.tsbuildinfo` shipped. `gt --version`
  printed `3.0.0`, and `gt --port 18777 --no-system-proxy` proxied both
  `HTTP/1.1 200 Connection Established` (HTTPS CONNECT) and `HTTP/1.1 200 OK`
  (plain HTTP) via DoH. That is the whole publish path short of the registry.

**Not yet verified — do not assume these work:**

- `SystemProxy` on **Linux and Windows**. Those drivers were updated alongside
  the macOS one but have still never been executed. Test deliberately.
- `electron-builder` **signing and notarization**, and packaging on **Windows and
  Linux** — the `--win` / `--linux` targets have still only ever been configured,
  not run.
- Windows and Linux at all.
- The log panel's **Save** button (it opens a native dialog, so it needs a human)
  and the tray's **Show Logs** item — the same `showLogs()` the row calls, but
  never clicked.

## Gotchas

- `npm audit` reports 16 highs. Every one is inside `electron-builder`'s
  transitive tree (`app-builder-lib`, `@electron/asar`, `ejs`, `temp`) — all
  build-time only, none shipped.
- **Never wrap a programmatic resize in `setResizable(true)` / `setResizable(false)`.**
  It is the usual advice for a `resizable: false` window and it is wrong on
  macOS: measured on 26, the first `setContentSize` lands and every later one is
  silently dropped — toggling the style mask pins the window to the size it had
  at that moment. Plain `setContentSize` works fine on a non-resizable window.
- Reading `window.innerHeight` over the DevTools protocol lags the real window
  size when the app is not frontmost: Chromium throttles the rendering pipeline
  for a background window, which also delays `ResizeObserver` callbacks. Trust
  the pixel dimensions of `Page.captureScreenshot` instead — that comes from the
  compositor. Costs an hour if you assume the resize code is broken.
- **Quad9 DoH does not work** and cannot: it answers `505 HTTP Version Not
Supported` to HTTP/1.1, and Node's `fetch` has no HTTP/2. Use
  `--dns dot --dot-host 9.9.9.9`.
- Linux system proxy is GSettings-only, so it covers GNOME and relatives.
  Terminal tools need `http_proxy`/`https_proxy`, which no process can set for
  another — the CLI prints the export line under `--no-system-proxy`.
- **Debugging "the internet is broken" on macOS: never trust the Wi-Fi pane.**
  `networksetup -getwebproxy Wi-Fi` says nothing about the other nine services,
  and the one that matters is whichever is highest in
  `networksetup -listnetworkserviceorder` _and_ currently active. Read the
  effective config instead:

  ```bash
  scutil <<< "show State:/Network/Global/Proxies"   # what apps actually use
  networksetup -listnetworkserviceorder             # who wins
  ```

  `HTTPEnable : 1` there with nothing listening on `HTTPPort` is the bug.

- Restoring a macOS proxy takes **two** writes, not one: `-setwebproxy` sets host
  and port _and_ enables it, so a service that had a host recorded but was
  switched off needs a following `-setwebproxystate … off`. Otherwise "restore"
  switches on a proxy the user had deliberately unchecked.
- The recovery snapshot lives at
  `~/Library/Application Support/green-tunnel/system-proxy-snapshot.json` and is
  shared by the CLI and the desktop app on purpose — either can clean up after
  the other. It stores the owning PID, and a live PID's snapshot is left alone so
  a second instance cannot rip the proxy out from under a running one.

## Release and distribution

Inherited from v2 during the promotion, and rewritten rather than copied — v2's
versions assumed `src/` + `bin/` at the root and a `gui/` that installed
`green-tunnel` from npm.

**`Dockerfile`** is two-stage and covers `packages/cli` only; `apps/desktop` would
drag ~200 MB of Electron build tooling into a CLI image. Two things about it are
load bearing:

- `npm ci --workspace packages/cli` still validates the _whole_ workspace tree
  against the lockfile, so `apps/desktop/package.json` has to be copied in even
  though it is never installed. Delete that `COPY` and the install fails on a
  lockfile mismatch, not on a missing directory.
- The `CMD` is **shell form on purpose** and uses `${VAR:+--flag}`. v3 parses
  arguments with `node:util.parseArgs`, where a boolean flag takes no value:
  v2's `--silent "$SILENT"` spelling would make `HTTPS_ONLY=false` a usage
  error rather than "off". Hence the README's warning that setting a boolean
  variable to _anything_ turns it on. hadolint's DL3025 is ignored for this.

**`.github/workflows/test.yml`** — format, `npm run check`, `npm run build`,
hadolint, then a real Docker build with `curl` through the container over both
HTTPS CONNECT and plain HTTP. It sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`:
typechecking and bundling need Electron's typings, not its 150 MB binary. The
packaging jobs must **not** set it.

**`.github/workflows/publish.yml`** fires on a `v*` **tag push** — v2 used
`on: create` with a `tags:` filter, which that event does not support, so it also
fired for branches. Then:

1. `verify` fails the run unless the tag matches `packages/cli`'s version. Bump
   `packages/cli` and the workspace root together. (`apps/desktop` is private, but
   electron-builder names the artifacts from its version — keep it in step.)
2. npm: one `npm publish`, no ordering to get wrong. No `--provenance` flag and no
   `NODE_AUTH_TOKEN`: see [Trusted publishing](#trusted-publishing-oidc) below.
3. Docker Hub: one multi-arch manifest (amd64 + arm64). v2's separate `arm-*`
   tag built from a sed-patched Dockerfile is gone, and so is 32-bit ARM —
   `node:24-alpine` has no armv7 variant.
4. electron-builder on all three runners with `--publish never`, artifacts
   uploaded, then a **draft** release. Draft, so a bad build is deleted rather
   than announced. macOS sets `CSC_IDENTITY_AUTO_DISCOVERY: false` — there is no
   Developer ID in CI, and without it electron-builder finds a half-usable
   identity and fails instead of shipping unsigned.

The desktop job builds the engine (`npm run build --workspace packages/cli`)
**before** packaging, and that step is not redundant. `electron-vite` bundles
`green-tunnel` by resolving the workspace symlink to its `main`, i.e.
`dist/index.js` — a path that does not exist in a fresh `npm ci` checkout. On a
dev machine `dist/` is left over from an earlier build, so the whole job passes
locally and fails only in CI, with a message that names neither the workspace nor
the missing build: `[commonjs--resolver] Failed to resolve entry for package`.
`test.yml` never hit this because its `npm run build` is the root script, which
already runs `tsc --build` first.

### What the v3.0.0 tag taught us, in one place

The first tag push failed four ways at once, which is worth remembering as a set
because only one of them was visible in the error the release actually stopped on:

1. `format:check` — seven files. It is the **first** step in `test.yml`, so it
   masked everything after it.
2. The missing engine build before packaging, above.
3. Electron's caret range, see [Pinned versions](#pinned-versions-and-why).
4. `404 Not Found - PUT …/@green-tunnel%2fcore` — the npm **scope did not exist**.
   That 404 reads like a missing package and really means "this scope is not
   yours"; `npm org ls green-tunnel` says `Scope not found` outright. Owning the
   unscoped `green-tunnel` package grants no `@green-tunnel` scope, and it could
   not be a personal scope either, since the account is `hayerisadegh` — it would
   have had to be an npm **organisation**, created by hand. That is what prompted
   [folding core back in](#one-package-not-two-and-why) instead, and the whole
   failure mode no longer exists.

That 404 is also silent about ordering: the tarball is packed and the provenance
statement is signed and **published to the sigstore transparency log** before the
registry is ever contacted. A log full of successful-looking provenance output can
still end in `E404`.

### Trusted publishing (OIDC)

There is no `NPM_TOKEN`. npm is
[restricting tokens that bypass 2FA](https://gh.io/npm-gat-bypass2fa-deprecation),
so `publish-npm` authenticates with GitHub's OIDC identity instead: `id-token:
write` is the only credential, and provenance is signed automatically — which is
why `--provenance` is **absent** and adding it back is not a no-op. Requirements
are met: npm ≥ 11.5.1 and Node ≥ 22.14 (`node-version: 24` resolves to 24.18,
which bundles npm 11.16).

This works only because `green-tunnel` **already exists on npm**. A trusted
publisher is configured **per package** in the npmjs.com UI, which needs the
package to be there first ([npm/cli#8544](https://github.com/npm/cli/issues/8544)) —
OIDC cannot perform a package's first publish. Publishing a brand-new package
would have meant a token publish to bootstrap it, and avoiding that is one more
reason the single-package layout is the right one. A configuration created after
**20 May 2026** must also explicitly select at least one allowed action; older
ones defaulted to `npm publish`.

`snapcraft.yaml` was **not** carried over: it was pinned to v1.7.4 on `core18`
(EOL) and built the old CLI. electron-builder can emit a snap if the Linux
target list ever wants one.

## Roadmap

Roughly in order:

1. Exercise and fix the `SystemProxy` drivers on **Linux and Windows** — macOS is
   now done (see [Verified](#verified)). Re-read the stranded-proxy section above
   first; those bugs live in the Linux/Windows drivers' shape too.
2. Packaging: signing, notarization, auto-update, and a Windows/Linux run.
   macOS now builds (see [Verified](#verified)) but ships unsigned.
   The icons are all generated from `assets/logo.png` — the same 2000×2000
   artwork v2 shipped as `gui/icon.png`, byte for byte — by the recipe recorded
   in `electron-builder.yml`. Regenerate all four together if it ever changes:
   `build/icon.{icns,ico,png}` for the installer and `resources/icon.png` for
   the windows Linux and Windows draw themselves, plus the dev dock.
3. CI: both workflows have run once, on `v3.0.0`, and failed
   [four ways](#what-the-v300-tag-taught-us-in-one-place). All four are fixed. The
   release still needs a **trusted publisher configured for `green-tunnel`** on
   npmjs.com (`SadeghHayeri/GreenTunnel`, workflow `publish.yml`) — the workflow
   carries no token, so without it `npm publish` cannot authenticate. Then re-push
   the tag.
4. More tests: `http/head.ts`, the DNS resolvers against a stub server, an
   integration test that drives `Proxy` over a loopback TLS server.
5. Features worth considering — per-site rules, a bypass list in the UI,
   SNI-aware split points (split _inside_ the hostname rather than at a fixed
   offset), QUIC/HTTP3 handling, PAC-file mode instead of a blunt system proxy.
   The live connection log that was on this list is now the
   [log panel](#the-log-panel).
