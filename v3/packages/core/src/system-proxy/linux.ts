import { SystemProxyError } from '../errors.js';
import type { ProxyEndpointState, SystemProxySettings, SystemProxySnapshot } from '../types.js';
import type { SystemProxyDriver } from './driver.js';
import { exec, isAvailable, settle, tryExec } from './exec.js';

const GSETTINGS = 'gsettings';
const SCHEMA = 'org.gnome.system.proxy';

/**
 * Linux driver, GNOME/GSettings flavour — which also covers Unity, Cinnamon,
 * Budgie and anything else reading the same schema.
 *
 * Note this only affects applications that honour the desktop proxy settings.
 * Terminal tools read `http_proxy`/`https_proxy`, which no process can set for
 * another; the CLI prints them for you to export.
 */
export class LinuxSystemProxy implements SystemProxyDriver {
  readonly platform: NodeJS.Platform = 'linux';

  async snapshot(): Promise<SystemProxySnapshot> {
    await this.#assertAvailable();
    const mode = unquote(await exec(GSETTINGS, ['get', SCHEMA, 'mode']));
    const enabled = mode === 'manual';

    return {
      platform: 'linux',
      entries: [
        {
          target: 'mode',
          enabled,
          ...(await readEndpoint('http')),
          secure: { enabled, ...(await readEndpoint('https')) },
          bypass: parseGVariantList(
            (await tryExec(GSETTINGS, ['get', SCHEMA, 'ignore-hosts'])) ?? '',
          ),
        },
      ],
    };
  }

  async apply(settings: SystemProxySettings): Promise<void> {
    await this.#assertAvailable();
    const port = String(settings.port);

    for (const protocol of ['http', 'https'] as const) {
      await exec(GSETTINGS, ['set', `${SCHEMA}.${protocol}`, 'host', settings.host]);
      await exec(GSETTINGS, ['set', `${SCHEMA}.${protocol}`, 'port', port]);
    }
    await exec(GSETTINGS, ['set', SCHEMA, 'ignore-hosts', toGVariantList(settings.bypass)]);
    // Flip the mode last, so nothing is ever routed at a half-written config.
    await exec(GSETTINGS, ['set', SCHEMA, 'mode', 'manual']);
  }

  async restore(snapshot: SystemProxySnapshot): Promise<void> {
    await this.#assertAvailable();
    const previous = snapshot.entries[0];
    if (!previous) return;

    // Turn the mode off *first*: until it is `none`, every write below is live
    // configuration that apps may pick up.
    await settle([
      async () => {
        if (!previous.enabled) await exec(GSETTINGS, ['set', SCHEMA, 'mode', 'none']);
      },
      () => writeEndpoint('http', previous),
      () => writeEndpoint('https', previous.secure ?? previous),
      () =>
        exec(GSETTINGS, [
          'set',
          SCHEMA,
          'ignore-hosts',
          toGVariantList(previous.bypass ?? []),
        ]).then(() => undefined),
      async () => {
        if (previous.enabled) await exec(GSETTINGS, ['set', SCHEMA, 'mode', 'manual']);
      },
    ]);
  }

  async #assertAvailable(): Promise<void> {
    if (!(await isAvailable(GSETTINGS, ['--version']))) {
      throw new SystemProxyError(
        'gsettings is not available — set the system proxy manually, or use the ' +
          'proxy directly at the address GreenTunnel printed.',
      );
    }
  }
}

async function readEndpoint(protocol: 'http' | 'https'): Promise<{ host: string; port: number }> {
  const host = unquote((await tryExec(GSETTINGS, ['get', `${SCHEMA}.${protocol}`, 'host'])) ?? '');
  const port = Number.parseInt(
    (await tryExec(GSETTINGS, ['get', `${SCHEMA}.${protocol}`, 'port'])) ?? '0',
    10,
  );
  return { host, port: port || 0 };
}

async function writeEndpoint(protocol: 'http' | 'https', state: ProxyEndpointState): Promise<void> {
  await exec(GSETTINGS, ['set', `${SCHEMA}.${protocol}`, 'host', state.host]);
  await exec(GSETTINGS, ['set', `${SCHEMA}.${protocol}`, 'port', String(state.port)]);
}

/** `gsettings get` wraps strings in single quotes. */
function unquote(value: string): string {
  return value.trim().replace(/^'(.*)'$/s, '$1');
}

function toGVariantList(values: readonly string[]): string {
  return `[${values.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(', ')}]`;
}

/** `['localhost', '127.0.0.0/8']` — or `@as []` for an empty list. */
function parseGVariantList(value: string): string[] {
  const items: string[] = [];
  for (const match of value.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
    items.push((match[1] ?? '').replace(/\\(.)/g, '$1'));
  }
  return items;
}
