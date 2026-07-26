import type {
  ProxyEndpointState,
  SystemProxySettings,
  SystemProxySnapshot,
  SystemProxySnapshotEntry,
} from '../types.js';
import type { SystemProxyDriver } from './driver.js';
import { exec, settle, tryExec } from './exec.js';

const NETWORKSETUP = '/usr/sbin/networksetup';

/** `networksetup` spells "no bypass domains" as this single literal argument. */
const EMPTY_BYPASS = 'Empty';

/**
 * macOS driver.
 *
 * v2 derived a single Wi-Fi service from the default route, so an Ethernet dock
 * or a second interface was left unproxied — and it never recorded what it
 * overwrote. This applies to every *enabled* service and restores each one.
 *
 * Two properties matter more than they look:
 *
 * 1. `apply` uses the snapshot's target list, never its own enumeration, so the
 *    set of services we touch and the set we can restore are identical by
 *    construction. See `SystemProxyDriver.apply`.
 * 2. `restore` is all-or-as-much-as-possible: one service that refuses a write
 *    must not abandon the rest. macOS happily lists VPN services (Tailscale,
 *    Shadowrocket) that reject proxy writes, and v3.0's `for` loop threw on the
 *    first one and left every later service proxied.
 *
 * Stranded HTTP proxies on macOS are unusually nasty: the OS publishes the
 * *highest-ranked active* service's config to `State:/Network/Global/Proxies`,
 * which is what every app reads. A leftover proxy on an unplugged dongle sits
 * invisible until the dongle reappears, then silently captures all traffic —
 * and System Settings shows Wi-Fi as clean, because the setting is elsewhere.
 */
export class DarwinSystemProxy implements SystemProxyDriver {
  readonly platform: NodeJS.Platform = 'darwin';

  async snapshot(): Promise<SystemProxySnapshot> {
    const entries: SystemProxySnapshotEntry[] = [];
    for (const service of await listEnabledServices()) {
      const entry = await readService(service);
      if (entry) entries.push(entry);
    }
    return { platform: 'darwin', entries };
  }

  async apply(settings: SystemProxySettings, snapshot: SystemProxySnapshot): Promise<void> {
    const port = String(settings.port);
    for (const { target } of snapshot.entries) {
      await exec(NETWORKSETUP, ['-setwebproxy', target, settings.host, port]);
      await exec(NETWORKSETUP, ['-setsecurewebproxy', target, settings.host, port]);
      // Always write the bypass list, even when empty: leaving the previous
      // list in place while our proxy is active would route the user's old
      // exceptions through us.
      await exec(NETWORKSETUP, [
        '-setproxybypassdomains',
        target,
        ...(settings.bypass.length > 0 ? settings.bypass : [EMPTY_BYPASS]),
      ]);
    }
  }

  async restore(snapshot: SystemProxySnapshot): Promise<void> {
    // Every entry gets an attempt; failures are collected and reported together
    // so a single stubborn service cannot strand the others.
    await settle(
      snapshot.entries.map((entry) => async () => {
        await restoreEndpoint('-setwebproxy', '-setwebproxystate', entry.target, entry);
        await restoreEndpoint(
          '-setsecurewebproxy',
          '-setsecurewebproxystate',
          entry.target,
          entry.secure ?? entry,
        );
        await exec(NETWORKSETUP, [
          '-setproxybypassdomains',
          entry.target,
          ...(entry.bypass && entry.bypass.length > 0 ? entry.bypass : [EMPTY_BYPASS]),
        ]);
      }),
    );
  }
}

/**
 * Restoring an endpoint takes two writes, not one: `-setwebproxy` sets host and
 * port *and* enables it, so a service that had a host recorded but was switched
 * off must be re-disabled afterwards. Otherwise "restore" would turn on a proxy
 * the user had deliberately unchecked.
 */
async function restoreEndpoint(
  setFlag: string,
  stateFlag: string,
  target: string,
  state: ProxyEndpointState,
): Promise<void> {
  if (state.host.length > 0 && state.port > 0) {
    await exec(NETWORKSETUP, [setFlag, target, state.host, String(state.port)]);
    if (!state.enabled) await exec(NETWORKSETUP, [stateFlag, target, 'off']);
    return;
  }

  // There was no proxy here, so blank the host/port too rather than only
  // unticking the box. macOS keeps the last value in the field, so skipping this
  // leaves our address sitting in System Settings looking like a configured
  // proxy — the exact thing a user checks when they suspect us.
  //
  // Best-effort: `state off` below is what actually guarantees correctness, so a
  // service that rejects the empty form must not fail the restore.
  await tryExec(NETWORKSETUP, [setFlag, target, '', '0']);
  await exec(NETWORKSETUP, [stateFlag, target, 'off']);
}

/**
 * `networksetup -listallnetworkservices` prints a header line, then one service
 * per line. Disabled services are prefixed with `*`.
 */
async function listEnabledServices(): Promise<string[]> {
  const output = await exec(NETWORKSETUP, ['-listallnetworkservices']);
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*'));
}

async function readService(service: string): Promise<SystemProxySnapshotEntry | undefined> {
  const web = await readEndpoint('-getwebproxy', service);
  if (!web) return undefined;
  const secure = await readEndpoint('-getsecurewebproxy', service);

  return {
    target: service,
    ...web,
    ...(secure ? { secure } : {}),
    bypass: await readBypassDomains(service),
  };
}

async function readEndpoint(
  flag: string,
  service: string,
): Promise<ProxyEndpointState | undefined> {
  const output = await tryExec(NETWORKSETUP, [flag, service]);
  if (output === undefined) return undefined;

  const fields = new Map<string, string>();
  for (const line of output.split('\n')) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      fields.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }

  return {
    enabled: fields.get('enabled')?.toLowerCase() === 'yes',
    host: fields.get('server') ?? '',
    port: Number.parseInt(fields.get('port') ?? '0', 10) || 0,
  };
}

/**
 * Either one domain per line, or the sentence "There aren't any bypass domains
 * set on <service>." — which is prose, not a domain, and must not be restored
 * as one.
 */
async function readBypassDomains(service: string): Promise<string[]> {
  const output = await tryExec(NETWORKSETUP, ['-getproxybypassdomains', service]);
  if (output === undefined) return [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes(' '));
}
