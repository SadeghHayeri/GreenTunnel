/**
 * What Green Tunnel says about itself when someone passes it on, and the three
 * places it can be posted from the share sheet.
 *
 * The copy lives here rather than inline in the renderer because it is a claim
 * about what the software does, and it has to stay true: no VPN, nothing
 * relayed, open source. It deliberately promises nothing about anonymity — the
 * window's own footnote says "Does not hide your IP address", and a share
 * message that implied otherwise would be the app lying on the user's behalf.
 *
 * Every target's `origin` is folded into `ALLOWED_EXTERNAL_ORIGINS` by
 * `ipc.ts`. `openExternal` refuses anything else, so adding a target here is
 * the only step needed — and forgetting the allowlist is not a way to fail.
 */

export const PROJECT_URL = 'https://github.com/SadeghHayeri/GreenTunnel';

/**
 * One message, reused by all three targets.
 *
 * Kept under 250 characters so it still fits a post on X once the link is
 * appended: X counts every link as 23 characters regardless of its length.
 */
export const SHARE_MESSAGE = [
  'Green Tunnel unblocks censored websites without a VPN.',
  "It's free and open source, runs on your own machine, and defeats DPI filtering — so nothing is relayed through someone else's server.",
  'Windows, macOS and Linux:',
].join('\n\n');

export type ShareTargetId = 'x' | 'telegram' | 'whatsapp';

export interface ShareTarget {
  readonly id: ShareTargetId;
  /** Shown under the icon, and read out as the button's name. */
  readonly label: string;
  /** Must be the exact origin of `href` — it is what the allowlist checks. */
  readonly origin: string;
  readonly href: string;
}

const message = encodeURIComponent(SHARE_MESSAGE);
const link = encodeURIComponent(PROJECT_URL);

export const SHARE_TARGETS = [
  {
    id: 'x',
    label: 'X',
    origin: 'https://x.com',
    // `x.com/intent/post` is the current endpoint; the old
    // `twitter.com/intent/tweet` only redirects here.
    href: `https://x.com/intent/post?text=${message}&url=${link}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    origin: 'https://t.me',
    href: `https://t.me/share/url?url=${link}&text=${message}`,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    origin: 'https://wa.me',
    // WhatsApp takes one blob, so the link has to be part of the text.
    href: `https://wa.me/?text=${encodeURIComponent(`${SHARE_MESSAGE}\n${PROJECT_URL}`)}`,
  },
] as const satisfies readonly ShareTarget[];
