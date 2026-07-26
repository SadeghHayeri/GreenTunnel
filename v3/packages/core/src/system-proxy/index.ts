import { platform } from 'node:process';
import { SystemProxyError, toError } from '../errors.js';
import type {
  ProxyEndpointState,
  SystemProxySettings,
  SystemProxySnapshot,
  SystemProxySnapshotEntry,
} from '../types.js';
import { DarwinSystemProxy } from './darwin.js';
import type { SystemProxyDriver } from './driver.js';
import { LinuxSystemProxy } from './linux.js';
import {
  defaultRecoveryPath,
  readRecoveryFile,
  removeRecoveryFile,
  writeRecoveryFile,
} from './recovery.js';
import { WindowsSystemProxy } from './windows.js';

export type { SystemProxyDriver } from './driver.js';
export { DarwinSystemProxy } from './darwin.js';
export { LinuxSystemProxy } from './linux.js';
export { WindowsSystemProxy } from './windows.js';
export { defaultRecoveryPath } from './recovery.js';

export const DEFAULT_BYPASS = ['localhost', '127.0.0.1', '::1', '*.local'] as const;

export function isSystemProxySupported(): boolean {
  return platform === 'darwin' || platform === 'linux' || platform === 'win32';
}

export function createSystemProxyDriver(): SystemProxyDriver {
  switch (platform) {
    case 'darwin':
      return new DarwinSystemProxy();
    case 'linux':
      return new LinuxSystemProxy();
    case 'win32':
      return new WindowsSystemProxy();
    default:
      throw new SystemProxyError(`Setting the system proxy is not supported on ${platform}`);
  }
}

export interface SystemProxyOptions {
  readonly driver?: SystemProxyDriver;
  /**
   * Where to persist the pending snapshot so a killed process can still be
   * cleaned up. `null` disables persistence (used by tests).
   */
  readonly recoveryFile?: string | null;
}

/**
 * Snapshot-and-restore wrapper around the platform drivers.
 *
 * The important property: `disable()` puts back exactly what was there before,
 * rather than v2's "turn everything off" — which quietly wiped a corporate or
 * developer proxy the user had configured.
 */
export class SystemProxy {
  readonly #driver: SystemProxyDriver;
  readonly #recoveryFile: string | null;
  #snapshot: SystemProxySnapshot | null = null;

  constructor(options: SystemProxyOptions = {}) {
    this.#driver = options.driver ?? createSystemProxyDriver();
    this.#recoveryFile =
      options.recoveryFile === undefined ? defaultRecoveryPath() : options.recoveryFile;
  }

  get active(): boolean {
    return this.#snapshot !== null;
  }

  async enable(settings: SystemProxySettings): Promise<void> {
    if (this.#snapshot) return;

    // Snapshot first: if `apply` throws halfway we can still put things back.
    // `disown` keeps us from mistaking our own leftovers for a user setting.
    const snapshot = disown(await this.#driver.snapshot(), settings);

    // Persist *before* touching the OS. If we are killed between here and
    // `disable()`, the next run finds this file and undoes the damage.
    if (this.#recoveryFile) {
      await writeRecoveryFile(this.#recoveryFile, snapshot).catch(() => undefined);
    }
    this.#snapshot = snapshot;

    try {
      await this.#driver.apply(settings, snapshot);
    } catch (error) {
      await this.#driver.restore(snapshot).catch(() => undefined);
      this.#snapshot = null;
      if (this.#recoveryFile) await removeRecoveryFile(this.#recoveryFile).catch(() => undefined);
      throw error;
    }
  }

  async disable(): Promise<void> {
    const snapshot = this.#snapshot;
    if (!snapshot) return;
    this.#snapshot = null;

    await this.#driver.restore(snapshot);

    // Drop the recovery file only once the OS is genuinely back. If `restore`
    // threw above, the file survives on purpose: the machine is still (partly)
    // pointed at us, and the next run must be able to finish the job. Clearing
    // it unconditionally is how a stranded proxy becomes permanent.
    if (this.#recoveryFile) await removeRecoveryFile(this.#recoveryFile).catch(() => undefined);
  }
}

/**
 * Undo a system proxy left behind by a run that never got to clean up — a
 * `SIGKILL`, a force-quit, a panic, a pulled power cord.
 *
 * Call this at startup, before `enable()`. Returns the snapshot it restored, or
 * `null` when there was nothing to recover.
 *
 * Without this, v3.0 had no path back at all: nothing recorded what had been
 * changed, so a killed process left the machine pointed at a dead port with no
 * way for any later run to know, or to fix it.
 */
export async function recoverSystemProxy(
  options: SystemProxyOptions = {},
): Promise<SystemProxySnapshot | null> {
  const path = options.recoveryFile === undefined ? defaultRecoveryPath() : options.recoveryFile;
  if (!path) return null;

  const snapshot = await readRecoveryFile(path);
  if (!snapshot) return null;

  const driver = options.driver ?? createSystemProxyDriver();
  try {
    await driver.restore(snapshot);
  } catch (error) {
    throw new SystemProxyError(
      `Could not undo the system proxy left by a previous run: ${toError(error).message}`,
      { cause: error },
    );
  }

  await removeRecoveryFile(path).catch(() => undefined);
  return snapshot;
}

/**
 * Rewrite any entry that is really *our own* leftover into "was off".
 *
 * Without this the damage is self-perpetuating: a run that fails to clean up
 * leaves `127.0.0.1:<our port>` behind, the next run records that as the user's
 * original proxy, and dutifully "restores" it on exit — forever. The recovery
 * file is the primary defence; this is the backstop for when it is missing,
 * stale, or was never written.
 *
 * A proxy pointing at loopback on the port we are about to bind cannot be a
 * useful upstream — nothing else is listening there once we take the port.
 */
function disown(snapshot: SystemProxySnapshot, settings: SystemProxySettings): SystemProxySnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => disownEntry(entry, settings)),
  };
}

function disownEntry(
  entry: SystemProxySnapshotEntry,
  settings: SystemProxySettings,
): SystemProxySnapshotEntry {
  const web = isOurs(entry, settings);
  const secure = entry.secure ? isOurs(entry.secure, settings) : web;
  if (!web && !secure) return entry;

  return {
    ...entry,
    ...(web ? OFF : { enabled: entry.enabled, host: entry.host, port: entry.port }),
    ...(entry.secure ? { secure: secure ? OFF : entry.secure } : {}),
    // If the proxy was ours, the bypass list we found next to it was ours too.
    ...(web && secure ? { bypass: [] } : {}),
  };
}

const OFF: ProxyEndpointState = { enabled: false, host: '', port: 0 };

function isOurs(state: ProxyEndpointState, settings: SystemProxySettings): boolean {
  if (state.port !== settings.port) return false;
  return state.host === settings.host || isLoopback(state.host);
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}
