/**
 * The user's own system-proxy exceptions: hosts the OS should reach directly
 * rather than through the tunnel.
 *
 * Shared by both sides so the renderer splits what was typed exactly the way the
 * main process validates what it stores.
 */

/** More than anyone types by hand, few enough to stay a sane registry value. */
const MAX_ENTRIES = 100;

/**
 * Host names, wildcards (`*.live.com`), IPv4/IPv6 literals and Windows'
 * `<local>` token. Anything else — a `;` above all, which is the separator
 * Windows stores the list with — would corrupt the setting it lands in.
 */
const ENTRY = /^(?:<local>|[a-z0-9*][a-z0-9*.:_[\]-]{0,252})$/;

/**
 * Microsoft account sign-in plus OneDrive sync, sent direct for two separate
 * reasons.
 *
 * Sign-in: on Windows that window is drawn by a sandboxed system component which
 * is not allowed to connect to `127.0.0.1`, so with the system proxy pointed at
 * the tunnel it cannot reach anything and sign-in fails. Sending these hosts
 * direct sidesteps the loopback rule rather than asking for admin rights to
 * lift it.
 *
 * Sync: Microsoft's account and OneDrive front ends never answer a ClientHello
 * split across TLS records — measured, even at two records — so with "TLS
 * records" on they hang until timeout. Direct, they are unaffected by it.
 */
export const MICROSOFT_HOSTS: readonly string[] = [
  '*.live.com',
  '*.live.net',
  '*.microsoftonline.com',
  '*.msauth.net',
  '*.msftauth.net',
  'login.windows.net',
  '*.onedrive.com',
  '*.1drv.com',
  '*.microsoftpersonalcontent.com',
  '*.sharepoint.com',
  'graph.microsoft.com',
  'substrate.office.com',
];

/**
 * Turn whatever was typed or stored into a clean list: split on whitespace,
 * commas and semicolons, lower-case, drop anything malformed, de-duplicate.
 */
export function parseBypassList(input: unknown): string[] {
  const parts =
    typeof input === 'string'
      ? input.split(/[\s,;]+/)
      : Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
        : [];

  const seen = new Set<string>();
  for (const part of parts) {
    const entry = part.trim().toLowerCase();
    if (ENTRY.test(entry)) seen.add(entry);
    if (seen.size >= MAX_ENTRIES) break;
  }
  return [...seen];
}
