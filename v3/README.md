# GreenTunnel v3

A local proxy that bypasses DPI (Deep Packet Inspection) censorship. It splits
the TLS ClientHello so the hostname you are visiting never appears whole in a
single packet, and resolves DNS over an encrypted channel so your resolver
cannot be used to block or observe you either.

> GreenTunnel does **not** hide your IP address and is not a VPN. It defeats
> hostname-based blocking, nothing more.

This is a ground-up TypeScript rewrite of GreenTunnel v2.

## Requirements

- **Node.js 24** (current LTS) or newer

## Install

```bash
npm install -g green-tunnel
gt
```

Or from this repo:

```bash
cd v3
npm install
npm run build
node packages/cli/dist/main.js
```

## Usage

```bash
gt                                   # bind 127.0.0.1:8000, set the system proxy
gt --port 8080 --tls-records         # stricter fragmentation
gt --dns dot --dot-host 9.9.9.9      # DNS over TLS via Quad9
gt --no-system-proxy                 # leave the OS alone, configure clients yourself
gt --help
```

`--help` lists every flag. The ones that matter:

| Flag                      | Does                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `--port <n>`              | Port to bind. `0` picks a free one.                                                 |
| `--fragment-size <n>`     | Bytes per ClientHello piece (default 40).                                           |
| `--tls-records`           | Re-frame pieces as individually valid TLS records — beats DPI that reassembles TCP. |
| `--fragment-delay <ms>`   | Pause between pieces — beats DPI that reassembles on a timer.                       |
| `--dns <doh\|dot\|plain>` | Encrypted DNS transport (default DoH).                                              |
| `--https-only`            | Refuse to proxy plain HTTP.                                                         |
| `--no-system-proxy`       | Do not touch OS proxy settings.                                                     |

If a site is still blocked, try in this order: a smaller `--fragment-size`, then
`--tls-records`, then `--fragment-delay 10`.

## Desktop app

```bash
npm run dev                              # development
npm run package --workspace apps/desktop # build an installer for this OS
```

A small window with an on/off switch, a tray icon, and controls for DNS
transport, port and fragmentation. It restores your previous system proxy
settings when it stops.

## Library

```ts
import { Proxy, SystemProxy, DEFAULT_BYPASS } from '@green-tunnel/core';

const proxy = new Proxy({
  port: 8000,
  fragment: { size: 40, tlsRecords: true },
  dns: { mode: 'doh' },
});

const { host, port } = await proxy.start();

const system = new SystemProxy();
await system.enable({ host, port, bypass: DEFAULT_BYPASS });

proxy.on('tunnel:open', ({ kind, host }) => {
  console.log(`${kind} → ${host}`);
});

// later
await system.disable();
await proxy.stop();
```

`green-tunnel` re-exports `@green-tunnel/core`, so v2's
`import { Proxy } from 'green-tunnel'` still works.

## Repository layout

```
packages/core/   the engine: proxy, TLS fragmentation, DNS, system proxy
packages/cli/    the `gt` command
apps/desktop/    the Electron app
```

## Development

```bash
npm run check    # typecheck + lint + test
npm run build
```

See [CLAUDE.md](./CLAUDE.md) for architecture notes, conventions, and what is
and is not verified.

## How it works

A DPI box blocking `example.com` looks for that string in the SNI field of the
TLS ClientHello — the one part of an HTTPS handshake still sent in cleartext.
GreenTunnel proxies your connection and, at the moment it forwards that
handshake, splits it:

- **TCP split** — the ClientHello is written across several small segments, so
  no single packet contains the whole hostname.
- **Record split** (`--tls-records`) — the handshake is re-framed into several
  individually valid TLS records. A box that reassembles TCP but inspects
  record-by-record still never sees a complete SNI. Legal per RFC 8446 §5.1.

Meanwhile hostnames resolve over DoH or DoT, so your ISP's resolver cannot
return a poisoned answer or log the lookup.

## License

MIT
