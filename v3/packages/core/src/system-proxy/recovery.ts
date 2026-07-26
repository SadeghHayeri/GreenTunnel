import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import type {
  ProxyEndpointState,
  SystemProxySnapshot,
  SystemProxySnapshotEntry,
} from '../types.js';

/**
 * Where the pending snapshot lives while the proxy is active.
 *
 * Deliberately *shared* between the CLI and the desktop app: if the CLI is
 * killed mid-run, the next launch of either one can put the machine back.
 * Deliberately *not* in `os.tmpdir()`, which macOS periodically sweeps — the
 * whole value of this file is surviving a crash and a reboot.
 */
export function defaultRecoveryPath(): string {
  const file = 'system-proxy-snapshot.json';
  const home = homedir();

  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'green-tunnel', file);
    case 'win32':
      return join(
        process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'),
        'green-tunnel',
        file,
      );
    default:
      return join(
        process.env['XDG_STATE_HOME'] ?? join(home, '.local', 'state'),
        'green-tunnel',
        file,
      );
  }
}

/** Record a snapshot before touching the OS, so a crash is still recoverable. */
export async function writeRecoveryFile(
  path: string,
  snapshot: SystemProxySnapshot,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...snapshot, pid: process.pid }, null, 2), 'utf8');
}

export async function removeRecoveryFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/**
 * Read a snapshot left behind by a previous run.
 *
 * Returns `undefined` when there is nothing to recover, when the file is
 * unreadable or corrupt, when it came from a different OS, or when the process
 * that wrote it is **still running** — that last case is a live owner, not an
 * orphan, and stealing its snapshot would rip the proxy out from under it.
 */
export async function readRecoveryFile(path: string): Promise<SystemProxySnapshot | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  const snapshot = parseSnapshot(parsed);
  if (!snapshot) return undefined;
  if (snapshot.platform !== process.platform) return undefined;
  if (snapshot.pid !== undefined && snapshot.pid !== process.pid && isProcessAlive(snapshot.pid)) {
    return undefined;
  }
  return snapshot;
}

/** Signal 0 tests for existence without delivering anything. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Validate rather than cast. This file is replayed straight into `networksetup`
 * / `reg.exe` argument arrays, so a truncated or hand-edited file must be
 * rejected outright instead of turning into nonsense arguments.
 */
function parseSnapshot(value: unknown): SystemProxySnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;

  const platform = raw['platform'];
  const rawEntries = raw['entries'];
  if (typeof platform !== 'string' || !Array.isArray(rawEntries)) return undefined;

  const entries: SystemProxySnapshotEntry[] = [];
  for (const candidate of rawEntries as unknown[]) {
    const entry = parseEntry(candidate);
    if (!entry) return undefined;
    entries.push(entry);
  }

  const pid = raw['pid'];
  return {
    platform: platform as NodeJS.Platform,
    entries,
    ...(typeof pid === 'number' ? { pid } : {}),
  };
}

function parseEntry(value: unknown): SystemProxySnapshotEntry | undefined {
  const endpoint = parseEndpoint(value);
  if (!endpoint) return undefined;

  const raw = value as Record<string, unknown>;
  const target = raw['target'];
  if (typeof target !== 'string' || target.length === 0) return undefined;

  const secure = raw['secure'] === undefined ? undefined : parseEndpoint(raw['secure']);
  if (raw['secure'] !== undefined && !secure) return undefined;

  const rawBypass = raw['bypass'];
  let bypass: string[] | undefined;
  if (rawBypass !== undefined) {
    if (!Array.isArray(rawBypass)) return undefined;
    if (!(rawBypass as unknown[]).every((item) => typeof item === 'string')) return undefined;
    bypass = rawBypass as string[];
  }

  return {
    target,
    ...endpoint,
    ...(secure ? { secure } : {}),
    ...(bypass ? { bypass } : {}),
  };
}

function parseEndpoint(value: unknown): ProxyEndpointState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const { enabled, host, port } = {
    enabled: raw['enabled'],
    host: raw['host'],
    port: raw['port'],
  };
  if (typeof enabled !== 'boolean' || typeof host !== 'string') return undefined;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65_535) {
    return undefined;
  }
  return { enabled, host, port };
}
