import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SystemProxySettings, SystemProxySnapshot } from '../types.js';
import type { SystemProxyDriver } from './driver.js';
import { settle } from './exec.js';
import { SystemProxy, recoverSystemProxy } from './index.js';
import { readRecoveryFile, writeRecoveryFile } from './recovery.js';

const SETTINGS: SystemProxySettings = {
  host: '127.0.0.1',
  port: 8000,
  bypass: ['localhost', '*.local'],
};

/**
 * Records what it was asked to do, so tests can assert on the *symmetry*
 * between apply and restore — which is where the real bug lived.
 */
class FakeDriver implements SystemProxyDriver {
  readonly platform: NodeJS.Platform = process.platform;
  applied: string[] = [];
  restored: string[] = [];
  failApply = false;

  readonly #entries: SystemProxySnapshot['entries'];

  constructor(entries: SystemProxySnapshot['entries']) {
    this.#entries = entries;
  }

  snapshot(): Promise<SystemProxySnapshot> {
    return Promise.resolve({ platform: this.platform, entries: this.#entries });
  }

  apply(_settings: SystemProxySettings, snapshot: SystemProxySnapshot): Promise<void> {
    this.applied = snapshot.entries.map((entry) => entry.target);
    if (this.failApply) return Promise.reject(new Error('apply exploded'));
    return Promise.resolve();
  }

  restore(snapshot: SystemProxySnapshot): Promise<void> {
    this.restored = snapshot.entries.map((entry) => entry.target);
    return Promise.resolve();
  }
}

describe('SystemProxy', () => {
  let dir: string;
  let recoveryFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gt-sysproxy-'));
    recoveryFile = join(dir, 'snapshot.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('restores every target it applied to', async () => {
    // The v3.0 bug: `apply` re-enumerated services instead of using the
    // snapshot, so it could touch targets `restore` knew nothing about.
    const driver = new FakeDriver([
      { target: 'Wi-Fi', enabled: false, host: '', port: 0 },
      { target: 'Thunderbolt Bridge', enabled: false, host: '', port: 0 },
    ]);
    const system = new SystemProxy({ driver, recoveryFile });

    await system.enable(SETTINGS);
    await system.disable();

    expect(driver.applied).toEqual(driver.restored);
    expect(driver.restored).toEqual(['Wi-Fi', 'Thunderbolt Bridge']);
  });

  it('does not record its own leftover proxy as the user’s setting', async () => {
    // A previous run died and left 127.0.0.1:8000 behind. Snapshotting that as
    // "the original" and restoring it on exit made the strand permanent.
    const driver = new FakeDriver([
      { target: 'Wi-Fi', enabled: true, host: '127.0.0.1', port: 8000, bypass: ['*.local'] },
    ]);
    const system = new SystemProxy({ driver, recoveryFile });

    await system.enable(SETTINGS);

    const persisted = await readRecoveryFile(recoveryFile);
    expect(persisted?.entries[0]).toMatchObject({ enabled: false, host: '', port: 0, bypass: [] });
  });

  it('keeps a genuine user proxy on a different port', async () => {
    const driver = new FakeDriver([
      { target: 'Wi-Fi', enabled: true, host: '10.0.0.9', port: 3128 },
    ]);
    const system = new SystemProxy({ driver, recoveryFile });

    await system.enable(SETTINGS);

    const persisted = await readRecoveryFile(recoveryFile);
    expect(persisted?.entries[0]).toMatchObject({ enabled: true, host: '10.0.0.9', port: 3128 });
  });

  it('leaves a loopback proxy on another port alone', async () => {
    // Another local proxy (Shadowrocket, mitmproxy) is a real setting, not ours.
    const driver = new FakeDriver([
      { target: 'Wi-Fi', enabled: true, host: '127.0.0.1', port: 12_334 },
    ]);
    await new SystemProxy({ driver, recoveryFile }).enable(SETTINGS);

    const persisted = await readRecoveryFile(recoveryFile);
    expect(persisted?.entries[0]).toMatchObject({ enabled: true, port: 12_334 });
  });

  it('writes the recovery file before touching the OS', async () => {
    const driver = new FakeDriver([{ target: 'Wi-Fi', enabled: false, host: '', port: 0 }]);
    let fileExistedDuringApply = false;
    const originalApply = driver.apply.bind(driver);
    driver.apply = async (settings, snapshot) => {
      fileExistedDuringApply = await readFile(recoveryFile, 'utf8').then(
        () => true,
        () => false,
      );
      return originalApply(settings, snapshot);
    };

    await new SystemProxy({ driver, recoveryFile }).enable(SETTINGS);
    expect(fileExistedDuringApply).toBe(true);
  });

  it('removes the recovery file after a clean restore', async () => {
    const driver = new FakeDriver([{ target: 'Wi-Fi', enabled: false, host: '', port: 0 }]);
    const system = new SystemProxy({ driver, recoveryFile });

    await system.enable(SETTINGS);
    await system.disable();

    await expect(readFile(recoveryFile, 'utf8')).rejects.toThrow();
  });

  it('keeps the recovery file when restore fails, so the next run can retry', async () => {
    const driver = new FakeDriver([{ target: 'Wi-Fi', enabled: false, host: '', port: 0 }]);
    const system = new SystemProxy({ driver, recoveryFile });
    await system.enable(SETTINGS);

    driver.restore = () => Promise.reject(new Error('networksetup died'));
    await expect(system.disable()).rejects.toThrow('networksetup died');

    expect(await readRecoveryFile(recoveryFile)).not.toBeNull();
  });

  it('rolls back and clears the file when apply fails', async () => {
    const driver = new FakeDriver([{ target: 'Wi-Fi', enabled: false, host: '', port: 0 }]);
    driver.failApply = true;
    const system = new SystemProxy({ driver, recoveryFile });

    await expect(system.enable(SETTINGS)).rejects.toThrow('apply exploded');
    expect(driver.restored).toEqual(['Wi-Fi']);
    expect(system.active).toBe(false);
    await expect(readFile(recoveryFile, 'utf8')).rejects.toThrow();
  });
});

describe('recoverSystemProxy', () => {
  let dir: string;
  let recoveryFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gt-recover-'));
    recoveryFile = join(dir, 'snapshot.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('restores a snapshot orphaned by a killed process', async () => {
    // PID 1 exists but is not us; simulate a dead owner with an unused PID.
    const deadPid = 0x7f_ff_ff;
    await writeFile(
      recoveryFile,
      JSON.stringify({
        platform: process.platform,
        pid: deadPid,
        entries: [{ target: 'Wi-Fi', enabled: false, host: '', port: 0 }],
      }),
      'utf8',
    );

    const driver = new FakeDriver([]);
    const recovered = await recoverSystemProxy({ driver, recoveryFile });

    expect(recovered?.entries).toHaveLength(1);
    expect(driver.restored).toEqual(['Wi-Fi']);
    await expect(readFile(recoveryFile, 'utf8')).rejects.toThrow();
  });

  it('leaves a snapshot owned by another live process alone', async () => {
    // Otherwise a second instance would rip the proxy out from under the first.
    // PID 1 is always alive and never us; on a non-root run `kill(1, 0)` fails
    // with EPERM, which still means "alive" and must be read that way.
    await writeFile(
      recoveryFile,
      JSON.stringify({
        platform: process.platform,
        pid: 1,
        entries: [{ target: 'Wi-Fi', enabled: false, host: '', port: 0 }],
      }),
      'utf8',
    );

    const driver = new FakeDriver([]);
    expect(await recoverSystemProxy({ driver, recoveryFile })).toBeNull();
    expect(driver.restored).toEqual([]);
    // And the file must survive, so its real owner can still clean up.
    expect(await readFile(recoveryFile, 'utf8')).toContain('Wi-Fi');
  });

  it('does nothing when there is no file', async () => {
    const driver = new FakeDriver([]);
    expect(await recoverSystemProxy({ driver, recoveryFile })).toBeNull();
  });

  it('rejects a corrupt file instead of feeding it to the OS', async () => {
    await writeFile(recoveryFile, '{"platform":"darwin","entries":[{"target":42}]}', 'utf8');
    expect(await readRecoveryFile(recoveryFile)).toBeUndefined();
  });

  it('rejects a snapshot from a different platform', async () => {
    const other = process.platform === 'darwin' ? 'win32' : 'darwin';
    await writeFile(
      recoveryFile,
      JSON.stringify({ platform: other, entries: [], pid: 0x7f_ff_ff }),
      'utf8',
    );
    expect(await readRecoveryFile(recoveryFile)).toBeUndefined();
  });

  it('round-trips every field a restore needs', async () => {
    const snapshot: SystemProxySnapshot = {
      platform: process.platform,
      entries: [
        {
          target: 'Wi-Fi',
          enabled: true,
          host: '10.0.0.9',
          port: 3128,
          secure: { enabled: false, host: '10.0.0.9', port: 3129 },
          bypass: ['*.corp', '169.254/16'],
        },
      ],
    };
    await writeRecoveryFile(recoveryFile, snapshot);

    const loaded = await readRecoveryFile(recoveryFile);
    expect(loaded?.entries[0]).toEqual(snapshot.entries[0]);
  });
});

describe('settle', () => {
  it('runs every task even when one throws', async () => {
    // A `for (…) await …` loop abandons the rest on the first failure. During
    // restore that means leaving services pointed at a dying port.
    const ran: number[] = [];
    const task =
      (n: number, fail = false) =>
      () => {
        ran.push(n);
        return fail ? Promise.reject(new Error(`task ${String(n)} failed`)) : Promise.resolve();
      };

    await expect(settle([task(1), task(2, true), task(3)])).rejects.toThrow('task 2 failed');
    expect(ran).toEqual([1, 2, 3]);
  });

  it('reports every failure together', async () => {
    const boom = (n: number) => () => Promise.reject(new Error(`boom ${String(n)}`));
    await expect(settle([boom(1), boom(2)])).rejects.toThrow(/boom 1; boom 2/);
  });

  it('resolves quietly when everything succeeds', async () => {
    await expect(
      settle([() => Promise.resolve(), () => Promise.resolve()]),
    ).resolves.toBeUndefined();
  });
});
