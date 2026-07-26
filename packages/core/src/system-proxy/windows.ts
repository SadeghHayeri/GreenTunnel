import type { SystemProxySettings, SystemProxySnapshot } from '../types.js';
import type { SystemProxyDriver } from './driver.js';
import { exec, settle, tryExec } from './exec.js';

const REG = 'reg.exe';
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/**
 * Windows driver, writing the WinINet settings every browser and most apps read.
 *
 * Uses `reg.exe` directly instead of the `winreg` package — one fewer
 * dependency, and the argument-array form removes v2's quoting problems.
 */
export class WindowsSystemProxy implements SystemProxyDriver {
  readonly platform: NodeJS.Platform = 'win32';

  async snapshot(): Promise<SystemProxySnapshot> {
    const enabled = (await readValue('ProxyEnable')) === '0x1';
    const server = (await readValue('ProxyServer')) ?? '';
    const [host = '', port = ''] = server.split(':');
    const override = (await readValue('ProxyOverride')) ?? '';

    return {
      platform: 'win32',
      entries: [
        {
          target: KEY,
          enabled,
          host,
          port: Number.parseInt(port, 10) || 0,
          bypass: override.length > 0 ? override.split(';') : [],
        },
      ],
    };
  }

  async apply(settings: SystemProxySettings): Promise<void> {
    await writeValue('ProxyServer', 'REG_SZ', `${settings.host}:${String(settings.port)}`);
    await writeValue(
      'ProxyOverride',
      'REG_SZ',
      settings.bypass.length > 0 ? settings.bypass.join(';') : '<local>',
    );
    // Enable last: until this flips, the values above are inert.
    await writeValue('ProxyEnable', 'REG_DWORD', '1');
    await refreshWinInet();
  }

  async restore(snapshot: SystemProxySnapshot): Promise<void> {
    const previous = snapshot.entries[0];
    if (!previous) return;

    const on = previous.enabled && previous.host.length > 0;

    await settle([
      // Disable first, so nothing is routed at a half-written config.
      async () => {
        if (!on) await writeValue('ProxyEnable', 'REG_DWORD', '0');
      },
      () =>
        writeValue('ProxyServer', 'REG_SZ', on ? `${previous.host}:${String(previous.port)}` : ''),
      () => writeValue('ProxyOverride', 'REG_SZ', (previous.bypass ?? []).join(';')),
      async () => {
        if (on) await writeValue('ProxyEnable', 'REG_DWORD', '1');
      },
      // Always tell WinINet to re-read, even if a write above failed.
      refreshWinInet,
    ]);
  }
}

async function readValue(name: string): Promise<string | undefined> {
  const output = await tryExec(REG, ['query', KEY, '/v', name]);
  // `    ProxyEnable    REG_DWORD    0x1`
  return output
    ?.split('\n')
    .find((line) => line.includes(name))
    ?.trim()
    .split(/\s{2,}/)[2];
}

async function writeValue(name: string, type: string, data: string): Promise<void> {
  await exec(REG, ['add', KEY, '/v', name, '/t', type, '/d', data, '/f']);
}

/**
 * Registry writes alone do not take effect until WinINet is told to re-read
 * them. There is no CLI for `InternetSetOption`, so drive it through PowerShell
 * — base64/UTF-16LE encoded to sidestep every layer of quoting.
 */
async function refreshWinInet(): Promise<void> {
  const script = `
$signature = @'
[DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
$wininet = Add-Type -MemberDefinition $signature -Name WinInet -Namespace Native -PassThru
# 39 = INTERNET_OPTION_SETTINGS_CHANGED, 37 = INTERNET_OPTION_REFRESH
$wininet::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
$wininet::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`.trim();

  await tryExec('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ]);
}
