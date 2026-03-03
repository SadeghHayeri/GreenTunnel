# GreenTunnel

CLI + Electron GUI that bypasses DPI censorship via SNI fragmentation and encrypted DNS.

## Commands

```bash
# Run CLI
node bin/gt.js
gt                        # after global install

# Install globally
npm install -g .

# Run GUI (Electron)
cd gui && ./node_modules/.bin/electron .

# Install deps
npm install               # root (CLI)
npm install --prefix gui  # GUI
```

## Architecture

- `bin/gt.js` — CLI entry point (native ESM)
- `src/proxy.js` — TCP proxy server
- `src/handlers/` — HTTP and HTTPS request handlers (SNI fragmentation happens here)
- `src/dns/` — DNS resolvers: `https.js` (DoH via native fetch), `tls.js`, `unencrypted.js`
- `src/utils/buffer.js` — TLS record fragmentation logic
- `src/utils/system-proxy.js` — sets OS system proxy (mac/linux/windows)
- `src/utils/analytics.js` — GA4 Measurement Protocol (fire-and-forget)
- `gui/main.js` — Electron main process

## Key Facts

- **Native ESM** (`"type": "module"`). All relative imports need `.js` extension.
- **Node >= 20** required (uses native `fetch` for DoH and GA4).
- `__dirname` not available in ESM — use `path.dirname(fileURLToPath(import.meta.url))`.
- CJS packages (e.g. `validator`) need default import: `import v from 'validator'; const { isIP } = v`.
- `lru-cache` v11 uses named export: `import { LRUCache } from 'lru-cache'`.
- GUI uses `contextIsolation: false` + `nodeIntegration: true` (legacy renderer).
- GUI imports `green-tunnel` via dynamic `await import('green-tunnel')` in `app.whenReady()`.

## Analytics

- GA4 Measurement ID: `G-D1R7M2YZ8Q`
- API Secret in `src/utils/analytics.js` → `API_SECRET`
- GUI uses gtag.js in `gui/view/main-page/index.html`

## CI/CD

- Tests run on push to `main` (Docker build + proxy test, Node module load test)
- Publishing triggered by `v*` tags → npm + Docker Hub + GitHub Release
- Dockerfile base: `node:20-alpine`
