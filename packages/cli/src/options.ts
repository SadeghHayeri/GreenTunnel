import { parseArgs } from 'node:util';
import { DEFAULT_SETTINGS, isLogLevel, type LogLevel, type ProxyOptions } from '@green-tunnel/core';

export interface RunOptions {
  readonly proxy: ProxyOptions;
  readonly systemProxy: boolean;
  readonly logLevel: LogLevel;
  readonly quiet: boolean;
}

export type ParseResult =
  | { readonly kind: 'run'; readonly options: RunOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' };

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const DNS_MODES = ['doh', 'dot', 'plain'] as const;
const FAMILIES = ['ipv4', 'ipv6', 'ipv4-first', 'ipv6-first'] as const;

/**
 * Argument parsing on `node:util.parseArgs` — no yargs, no dependencies.
 * `allowNegative` gives us `--no-fragment` / `--no-system-proxy` for free.
 */
export function parseCliArgs(argv: readonly string[]): ParseResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowNegative: true,
      strict: true,
      options: {
        host: { type: 'string' },
        port: { type: 'string', short: 'p' },
        'https-only': { type: 'boolean', default: false },

        fragment: { type: 'boolean', default: true },
        'fragment-size': { type: 'string' },
        'fragment-delay': { type: 'string' },
        'tls-records': { type: 'boolean', default: false },

        dns: { type: 'string' },
        'doh-url': { type: 'string' },
        'dot-host': { type: 'string' },
        'dot-port': { type: 'string' },
        'dns-server': { type: 'string', multiple: true },
        family: { type: 'string' },

        'system-proxy': { type: 'boolean', default: true },
        'log-level': { type: 'string' },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'V', default: false },
      },
    });
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }

  const values = parsed.values;
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  const logLevel = values['log-level'];
  if (logLevel !== undefined && !isLogLevel(logLevel)) {
    throw new UsageError(`--log-level must be one of silent, error, warn, info, debug, trace`);
  }

  const proxy: ProxyOptions = {
    ...(values.host === undefined ? {} : { host: values.host }),
    ...(values.port === undefined ? {} : { port: integer('--port', values.port, 0, 65_535) }),
    httpsOnly: values['https-only'],
    fragment: {
      enabled: values.fragment,
      tlsRecords: values['tls-records'],
      ...(values['fragment-size'] === undefined
        ? {}
        : { size: integer('--fragment-size', values['fragment-size'], 1, 16_384) }),
      ...(values['fragment-delay'] === undefined
        ? {}
        : { delayMs: integer('--fragment-delay', values['fragment-delay'], 0, 60_000) }),
    },
    dns: {
      mode: oneOf('--dns', values.dns, DNS_MODES, DEFAULT_SETTINGS.dns.mode),
      family: oneOf('--family', values.family, FAMILIES, DEFAULT_SETTINGS.dns.family),
      ...(values['doh-url'] === undefined ? {} : { dohUrl: values['doh-url'] }),
      ...(values['dot-host'] === undefined ? {} : { dotHost: values['dot-host'] }),
      ...(values['dot-port'] === undefined
        ? {}
        : { dotPort: integer('--dot-port', values['dot-port'], 1, 65_535) }),
      ...(values['dns-server'] === undefined ? {} : { plainServers: values['dns-server'] }),
    },
  };

  return {
    kind: 'run',
    options: {
      proxy,
      systemProxy: values['system-proxy'],
      logLevel: logLevel ?? (values.quiet ? 'silent' : 'error'),
      quiet: values.quiet,
    },
  };
}

function integer(flag: string, raw: string, min: number, max: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`${flag} must be an integer between ${String(min)} and ${String(max)}`);
  }
  return value;
}

function oneOf<T extends string>(
  flag: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw === undefined) return fallback;
  const match = allowed.find((value) => value === raw);
  if (!match) {
    throw new UsageError(`${flag} must be one of ${allowed.join(', ')}`);
  }
  return match;
}

export const HELP_TEXT = `
Usage: gt [options]

  Runs a local proxy that splits the TLS ClientHello so DPI systems cannot read
  the SNI, and resolves hostnames over encrypted DNS.

Server
  --host <ip>              Address to bind          (default: ${DEFAULT_SETTINGS.host})
  -p, --port <n>           Port to bind, 0 = random (default: ${String(DEFAULT_SETTINGS.port)})
  --https-only             Reject plain HTTP requests

Fragmentation
  --no-fragment            Forward the ClientHello untouched
  --fragment-size <n>      Bytes per piece          (default: ${String(DEFAULT_SETTINGS.fragment.size)})
  --tls-records            Re-frame pieces as valid TLS records
  --fragment-delay <ms>    Pause between pieces     (default: ${String(DEFAULT_SETTINGS.fragment.delayMs)})

DNS
  --dns <mode>             doh | dot | plain        (default: ${DEFAULT_SETTINGS.dns.mode})
  --doh-url <url>          DoH endpoint             (default: ${DEFAULT_SETTINGS.dns.dohUrl})
  --dot-host <host>        DoT server               (default: ${DEFAULT_SETTINGS.dns.dotHost})
  --dot-port <n>           DoT port                 (default: ${String(DEFAULT_SETTINGS.dns.dotPort)})
  --dns-server <ip>        Plain resolver, repeatable
  --family <pref>          ipv4 | ipv6 | ipv4-first | ipv6-first

Other
  --no-system-proxy        Do not touch the OS proxy settings
  --log-level <level>      silent | error | warn | info | debug | trace
  -q, --quiet              No banner, no logs
  -h, --help               Show this help
  -V, --version            Show the version

Examples
  gt
  gt --port 8080 --tls-records
  gt --dns dot --dot-host 9.9.9.9
  gt --dns plain --dns-server 1.1.1.1 --no-system-proxy

Issues: https://github.com/SadeghHayeri/GreenTunnel/issues
`.trim();
