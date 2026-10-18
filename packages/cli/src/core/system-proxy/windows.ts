import type { SystemProxySettings, SystemProxySnapshot } from '../types.js';
import { SystemProxyError } from '../errors.js';
import { Logger } from '../logger.js';
import type { SystemProxyDriver } from './driver.js';
import { exec } from './exec.js';

/** Recorded as the entry's target; there is exactly one per-user LAN setting. */
const TARGET = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

// `INTERNET_PER_CONN_FLAGS` bits.
const PROXY_TYPE_DIRECT = 0x1;
const PROXY_TYPE_PROXY = 0x2;
const PROXY_TYPE_AUTO_PROXY_URL = 0x4;
const PROXY_TYPE_AUTO_DETECT = 0x8;

/** The LAN proxy configuration exactly as WinINet stores it. */
interface WinInetProxy {
  readonly flags: number;
  readonly server: string;
  readonly bypass: string;
  readonly autoConfigUrl: string;
}

/**
 * Windows driver, through WinINet's per-connection options.
 *
 * v3.0 wrote `ProxyEnable` / `ProxyServer` / `ProxyOverride` with `reg.exe`.
 * Those values are a compatibility mirror: the configuration Windows actually
 * reads lives in a binary record beside them (`DefaultConnectionSettings`), and
 * the API below is the only supported way to write it. Writing just the mirror
 * left the two disagreeing — Settings showed the proxy as *off* while WinINet
 * apps used it, and WinHTTP clients (OneDrive among them, and the certificate
 * revocation fetcher) read the other copy. OneDrive spun forever on "signing
 * in" in exactly that state, and worked with the same proxy set through the
 * Settings app, which updates both.
 */
export class WindowsSystemProxy implements SystemProxyDriver {
  readonly platform: NodeJS.Platform = 'win32';
  readonly #log: Logger;

  constructor(logger: Logger = new Logger('system-proxy', { level: 'silent' })) {
    this.#log = logger;
  }

  async snapshot(): Promise<SystemProxySnapshot> {
    const current = await queryProxy();
    const [host = '', port = ''] = current.server.split(':');

    return {
      platform: 'win32',
      entries: [
        {
          target: TARGET,
          enabled: (current.flags & PROXY_TYPE_PROXY) !== 0,
          host,
          port: Number.parseInt(port, 10) || 0,
          bypass: current.bypass.length > 0 ? current.bypass.split(';') : [],
          autoDetect: (current.flags & PROXY_TYPE_AUTO_DETECT) !== 0,
          autoConfigUrl: current.autoConfigUrl,
          autoConfig: (current.flags & PROXY_TYPE_AUTO_PROXY_URL) !== 0,
        },
      ],
    };
  }

  async apply(settings: SystemProxySettings, snapshot: SystemProxySnapshot): Promise<void> {
    const previous = snapshot.entries[0];

    // Auto-detect stays as the user had it, which is what the Settings app does
    // when it sets a manual proxy. A PAC script is switched off while we run —
    // Windows consults it *before* the manual proxy, so leaving it on would
    // route around the tunnel — and comes back on restore.
    const dropped = await setProxy({
      flags:
        PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY | (previous?.autoDetect ? PROXY_TYPE_AUTO_DETECT : 0),
      server: `${settings.host}:${String(settings.port)}`,
      bypass: settings.bypass.length > 0 ? toBypassList(settings.bypass) : '<local>',
      autoConfigUrl: previous?.autoConfigUrl ?? '',
    });
    this.#warnDropped(dropped);
  }

  async restore(snapshot: SystemProxySnapshot): Promise<void> {
    const previous = snapshot.entries[0];
    if (!previous) return;

    // A snapshot written by v3.0 has no auto-detect reading. Keep whatever the
    // flag is now rather than guessing — v3.0 never touched it, so now is right.
    const autoDetect =
      previous.autoDetect ?? ((await queryProxy()).flags & PROXY_TYPE_AUTO_DETECT) !== 0;
    const on = previous.enabled && previous.host.length > 0;

    // One write sets every field together, so there is no half-restored state
    // to order around — v3.0 needed "disable first" because it wrote three
    // registry values one at a time.
    const dropped = await setProxy({
      flags:
        PROXY_TYPE_DIRECT |
        (on ? PROXY_TYPE_PROXY : 0) |
        (autoDetect ? PROXY_TYPE_AUTO_DETECT : 0) |
        (previous.autoConfig ? PROXY_TYPE_AUTO_PROXY_URL : 0),
      // Kept even while off, as the Settings app keeps an unchecked address.
      server: previous.host.length > 0 ? `${previous.host}:${String(previous.port)}` : '',
      bypass: toBypassList(previous.bypass ?? []),
      autoConfigUrl: previous.autoConfigUrl ?? '',
    });
    this.#warnDropped(dropped);
  }

  /**
   * Some Windows builds reject bypass entries that others accept, and one bad
   * entry used to fail the whole write — the tunnel then refused to start at
   * all. The rest of the list is still applied; say which entries were not.
   */
  #warnDropped(dropped: readonly string[]): void {
    if (dropped.length > 0) {
      this.#log.warn(
        `Windows rejected these proxy bypass entries, left out: ${dropped.join(', ')}`,
      );
    }
  }
}

/**
 * Join a bypass list the way WinINet accepts it. A bare IPv6 literal — the
 * `::1` in `DEFAULT_BYPASS` — fails the whole write with "The parameter is
 * incorrect"; the bracketed `[::1]` is accepted. v3.0 never saw this because it
 * wrote the registry mirror directly, which validates nothing, so snapshots it
 * took can still hold the bare form and have to be converted on restore too.
 */
function toBypassList(entries: readonly string[]): string {
  return entries
    .map((entry) => (entry.includes(':') && !entry.startsWith('[') ? `[${entry}]` : entry))
    .join(';');
}

/**
 * `InternetQueryOption` / `InternetSetOption` with
 * `INTERNET_OPTION_PER_CONNECTION_OPTION`, compiled through PowerShell — there
 * is no command-line tool for it, and this keeps the engine free of native
 * modules. A NULL connection name means the LAN settings.
 *
 * Flags are read through `INTERNET_PER_CONN_FLAGS_UI` where available: plain
 * `INTERNET_PER_CONN_FLAGS` under-reports auto-detect on Windows 8 and later.
 * They are written through both, for the same reason.
 */
const WININET_TYPE = `
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class GtWinInet {
  [StructLayout(LayoutKind.Explicit)]
  public struct Value {
    [FieldOffset(0)] public int Int;
    [FieldOffset(0)] public IntPtr Ptr;
    [FieldOffset(0)] public long FileTime;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct Option { public int Id; public Value V; }

  [StructLayout(LayoutKind.Sequential)]
  public struct List {
    public int Size; public IntPtr Connection; public int Count; public int Error; public IntPtr Options;
  }

  [DllImport("wininet.dll", EntryPoint = "InternetQueryOptionW", SetLastError = true)]
  static extern bool QueryList(IntPtr h, int option, ref List list, ref int length);
  [DllImport("wininet.dll", EntryPoint = "InternetSetOptionW", SetLastError = true)]
  static extern bool SetList(IntPtr h, int option, ref List list, int length);
  [DllImport("wininet.dll", EntryPoint = "InternetSetOptionW", SetLastError = true)]
  static extern bool SetRaw(IntPtr h, int option, IntPtr buffer, int length);
  [DllImport("kernel32.dll")]
  static extern IntPtr GlobalFree(IntPtr p);

  const int PER_CONNECTION = 75, SETTINGS_CHANGED = 39, REFRESH = 37;
  const int FLAGS = 1, SERVER = 2, BYPASS = 3, AUTOCONFIG_URL = 4, FLAGS_UI = 10;

  static Option[] Run(Option[] options, bool set) {
    int size = Marshal.SizeOf(typeof(Option));
    IntPtr buffer = Marshal.AllocHGlobal(size * options.Length);
    try {
      for (int i = 0; i < options.Length; i++)
        Marshal.StructureToPtr(options[i], IntPtr.Add(buffer, i * size), false);
      List list = new List();
      list.Size = Marshal.SizeOf(typeof(List));
      list.Count = options.Length;
      list.Options = buffer;
      int length = list.Size;
      bool ok = set
        ? SetList(IntPtr.Zero, PER_CONNECTION, ref list, length)
        : QueryList(IntPtr.Zero, PER_CONNECTION, ref list, ref length);
      if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
      Option[] result = new Option[options.Length];
      for (int i = 0; i < options.Length; i++)
        result[i] = (Option)Marshal.PtrToStructure(IntPtr.Add(buffer, i * size), typeof(Option));
      return result;
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  static Option Make(int id, int value) { Option o = new Option(); o.Id = id; o.V.Int = value; return o; }
  static Option Make(int id, IntPtr value) { Option o = new Option(); o.Id = id; o.V.Ptr = value; return o; }

  static int Flags() {
    try { return Run(new Option[] { Make(FLAGS_UI, 0) }, false)[0].V.Int; }
    catch (Win32Exception) { return Run(new Option[] { Make(FLAGS, 0) }, false)[0].V.Int; }
  }

  static string Text(int id) {
    IntPtr p = Run(new Option[] { Make(id, IntPtr.Zero) }, false)[0].V.Ptr;
    if (p == IntPtr.Zero) return "";
    string s = Marshal.PtrToStringUni(p);
    GlobalFree(p);
    return s;
  }

  public static string[] Get() {
    return new string[] { Flags().ToString(), Text(SERVER), Text(BYPASS), Text(AUTOCONFIG_URL) };
  }

  const int ERROR_INVALID_PARAMETER = 87;

  static void Write(int flags, string server, string bypass, string autoConfigUrl) {
    IntPtr s = Marshal.StringToHGlobalUni(server);
    IntPtr b = Marshal.StringToHGlobalUni(bypass);
    IntPtr u = Marshal.StringToHGlobalUni(autoConfigUrl);
    try {
      Run(new Option[] { Make(FLAGS, flags), Make(SERVER, s), Make(BYPASS, b), Make(AUTOCONFIG_URL, u) }, true);
      try { Run(new Option[] { Make(FLAGS_UI, flags) }, true); } catch (Win32Exception) { }
    } finally {
      Marshal.FreeHGlobal(s); Marshal.FreeHGlobal(b); Marshal.FreeHGlobal(u);
    }
  }

  // Returns the bypass entries Windows refused and that were left out.
  public static string[] Set(int flags, string server, string bypass, string autoConfigUrl) {
    List<string> dropped = new List<string>();
    try {
      Write(flags, server, bypass, autoConfigUrl);
    } catch (Win32Exception e) {
      if (e.NativeErrorCode != ERROR_INVALID_PARAMETER || bypass.Length == 0) throw;
      // One bad entry fails the whole write, and which entries count as bad
      // differs between Windows builds. Add them back one at a time and keep
      // whatever is accepted. If even the empty list fails, the fault is not
      // in the bypass list and this rethrows the same error.
      Write(flags, server, "", autoConfigUrl);
      List<string> kept = new List<string>();
      foreach (string entry in bypass.Split(';')) {
        if (entry.Length == 0) continue;
        kept.Add(entry);
        try { Write(flags, server, string.Join(";", kept.ToArray()), autoConfigUrl); }
        catch (Win32Exception again) {
          if (again.NativeErrorCode != ERROR_INVALID_PARAMETER) throw;
          kept.RemoveAt(kept.Count - 1);
          dropped.Add(entry);
        }
      }
    }
    // Tell every WinINet client to re-read, as the Settings app does.
    SetRaw(IntPtr.Zero, SETTINGS_CHANGED, IntPtr.Zero, 0);
    SetRaw(IntPtr.Zero, REFRESH, IntPtr.Zero, 0);
    return dropped.ToArray();
  }
}
`;

async function queryProxy(): Promise<WinInetProxy> {
  const output = await runWinInet({ op: 'get' });
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new SystemProxyError(`Unexpected WinINet proxy reading: ${output}`);
  }
  const [flags, server, bypass, autoConfigUrl] = parsed.map((value) => String(value ?? ''));
  return {
    flags: Number.parseInt(flags ?? '', 10) || PROXY_TYPE_DIRECT,
    server: server ?? '',
    bypass: bypass ?? '',
    autoConfigUrl: autoConfigUrl ?? '',
  };
}

/** Write the LAN proxy configuration; returns the bypass entries Windows refused. */
async function setProxy(state: WinInetProxy): Promise<string[]> {
  const output = await runWinInet({ op: 'set', ...state });
  if (output.length === 0) return [];
  const parsed: unknown = JSON.parse(output);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

/**
 * The request travels as base64 JSON inside the script, and the script as
 * base64 UTF-16 on the command line, so no value is ever re-parsed by a shell.
 */
async function runWinInet(
  request: { op: 'get' } | ({ op: 'set' } & WinInetProxy),
): Promise<string> {
  const payload = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${WININET_TYPE}
'@
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
if ($request.op -eq 'get') {
  ConvertTo-Json -Compress -InputObject @([GtWinInet]::Get())
} else {
  ConvertTo-Json -Compress -InputObject @([GtWinInet]::Set([int]$request.flags, [string]$request.server, [string]$request.bypass, [string]$request.autoConfigUrl))
}
`.trim();

  const output = await exec('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ]);
  return output.trim();
}
