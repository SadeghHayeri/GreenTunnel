import process from 'node:process';
import type { ProxyAddress, ProxySettings } from '@green-tunnel/core';

const BRAND: readonly [number, number, number] = [132, 198, 111];

const ESC = '\u001B[';
const RESET = `${ESC}0m`;

// `isTTY` is typed as `boolean` but is genuinely `undefined` when stdout is a
// pipe — falsy either way, which is what we want.
const colorEnabled =
  process.stdout.isTTY && process.env['NO_COLOR'] === undefined && process.env['TERM'] !== 'dumb';

function paint(code: string, text: string): string {
  return colorEnabled ? `${ESC}${code}m${text}${RESET}` : text;
}

const [R, G, B] = BRAND;

/** A run of brand-coloured background — the pixels the logo is drawn with. */
function block(width: number): string {
  if (!colorEnabled) return '#'.repeat(width);
  return paint(`48;2;${String(R)};${String(G)};${String(B)}`, ' '.repeat(width));
}

const brand = (text: string): string => paint(`38;2;${String(R)};${String(G)};${String(B)}`, text);
const bold = (text: string): string => paint('1', text);
const dim = (text: string): string => paint('2', text);
const red = (text: string): string => paint('31', text);

const PAD = '  ';

export function printBanner(): void {
  const lines = [
    `${PAD}    ${block(4)}`,
    `${PAD} ${block(10)}`,
    `${PAD}${block(12)}`,
    `${PAD}${block(5)}  ${block(5)}`,
    `${PAD}${block(3)}      ${block(3)}`,
    `${PAD}${block(1)}          ${block(1)}`,
  ];
  console.log(`\n${lines.join('\n')}\n`);
  console.log(`${PAD}${brand(bold('Green'))} ${bold('Tunnel')}\n`);
}

export function printStatus(
  address: ProxyAddress,
  settings: ProxySettings,
  systemProxy: boolean,
): void {
  const endpoint = `${address.host}:${String(address.port)}`;
  const fragmentation = settings.fragment.enabled
    ? `${settings.fragment.tlsRecords ? 'TLS records' : 'TCP segments'} of ${String(settings.fragment.size)}B`
    : 'off';

  console.log(`${PAD}${brand('●')} running on ${bold(endpoint)}`);
  console.log(`${PAD}${dim(`fragmentation  ${fragmentation}`)}`);
  console.log(`${PAD}${dim(`dns            ${describeDns(settings)}`)}`);
  console.log(
    `${PAD}${dim(`system proxy   ${systemProxy ? 'managed by GreenTunnel' : 'untouched'}`)}`,
  );

  if (!systemProxy) {
    console.log(`\n${PAD}${dim('Point your client at it, or export:')}`);
    console.log(
      `${PAD}${dim(`export http_proxy=http://${endpoint} https_proxy=http://${endpoint}`)}`,
    );
  }

  console.log(`\n${PAD}${dim('GreenTunnel does not hide your IP address.')}`);
  console.log(`${PAD}${dim('Press Ctrl+C to stop.')}\n`);
}

function describeDns(settings: ProxySettings): string {
  switch (settings.dns.mode) {
    case 'doh':
      return `DoH via ${new URL(settings.dns.dohUrl).host}`;
    case 'dot':
      return `DoT via ${settings.dns.dotHost}:${String(settings.dns.dotPort)}`;
    case 'plain':
      return settings.dns.plainServers.length > 0
        ? `plain via ${settings.dns.plainServers.join(', ')}`
        : 'plain via system resolvers';
  }
}

/**
 * Acknowledge the stop request before teardown starts.
 *
 * Restoring the system proxy means several `networksetup`/`gsettings` calls,
 * which take long enough that a silent CLI looks wedged — and the user's next
 * move is a second Ctrl-C, the one thing that can strand their network
 * settings. So say what is happening, and say it is worth waiting for.
 */
export function printStopping(restoresSystemProxy: boolean): void {
  // Ctrl+C echoes `^C` with no trailing newline, so open on a fresh line.
  console.error(`\n${PAD}${brand('◆')} ${bold('Stopping GreenTunnel…')}`);
  console.error(
    `${PAD}${dim(
      restoresSystemProxy
        ? "Restoring your system proxy settings — please don't force-quit."
        : 'Closing connections — one moment.',
    )}`,
  );
}

/** Confirm teardown finished, so the user knows the machine is clean. */
export function printStopped(restoredSystemProxy: boolean): void {
  const detail = restoredSystemProxy ? ' Your network settings are back to how they were.' : '';
  console.error(`${PAD}${brand('✔')} Stopped.${detail}\n`);
}

export function printError(message: string): void {
  console.error(`${PAD}${red('✖')} ${message}`);
}

export function printNotice(message: string): void {
  console.error(`${PAD}${dim(message)}`);
}
