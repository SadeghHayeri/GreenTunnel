import { PROJECT_URL } from '../../shared/share.js';
import type { AppSettings, AppState, DnsMode } from '../../shared/types.js';
import { anySheetOpen, initAdvocacy, openShareSheet } from './advocacy.js';

const api = window.greenTunnel;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Must outlast the main process's resize, or the panel vanishes mid-shrink. */
const COLLAPSE_MS = 300;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Fail loudly at boot rather than silently no-op'ing a missing control, and
 * check the element really is the type we are about to treat it as.
 */
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`#${id} is missing or is not a ${type.name}`);
  }
  return found;
}

const ui = {
  app: element('app', HTMLDivElement),
  hide: element('hide', HTMLButtonElement),
  power: element('power', HTMLButtonElement),
  halo: element('halo', HTMLSpanElement),
  status: element('status', HTMLParagraphElement),
  readout: element('readout', HTMLDivElement),
  endpoint: element('endpoint', HTMLParagraphElement),
  error: element('error', HTMLParagraphElement),
  sent: element('sent', HTMLElement),
  received: element('received', HTMLElement),
  tunnels: element('tunnels', HTMLElement),
  disclosure: element('advanced-toggle', HTMLButtonElement),
  advanced: element('advanced', HTMLElement),
  source: element('source', HTMLButtonElement),
  openLogs: element('open-logs', HTMLButtonElement),
  share: element('share', HTMLButtonElement),
  dnsMode: element('dns-mode', HTMLSelectElement),
  port: element('port', HTMLInputElement),
  fragmentSize: element('fragment-size', HTMLInputElement),
  tlsRecords: element('tls-records', HTMLInputElement),
  systemProxy: element('system-proxy', HTMLInputElement),
  startOnLaunch: element('start-on-launch', HTMLInputElement),
  launchAtLogin: element('launch-at-login', HTMLInputElement),
};

const CONTROLS = [
  ui.dnsMode,
  ui.port,
  ui.fragmentSize,
  ui.tlsRecords,
  ui.systemProxy,
  ui.startOnLaunch,
  ui.launchAtLogin,
];

/** v2's wording, extended to the states v2 could not report. */
const STATUS_LABEL: Record<AppState['status'], string> = {
  off: 'is off',
  // "connecting" would be a lie: there is no session to establish, only a
  // local proxy to bind. v2 said it anyway.
  starting: 'starting…',
  on: 'is on',
  stopping: 'stopping…',
  error: 'failed to start',
};

/** Which of the stacked readings owns the slot under the status line. */
const READOUT_VIEW: Record<AppState['status'], string> = {
  off: 'idle',
  starting: 'busy',
  on: 'live',
  stopping: 'busy',
  error: 'error',
};

// ── Rendering ─────────────────────────────────────────────────────────────

let lastStatus: AppState['status'] | null = null;

function render(state: AppState): void {
  const busy = state.status === 'starting' || state.status === 'stopping';
  const on = state.status === 'on';

  ui.power.setAttribute('aria-pressed', String(on));
  ui.power.disabled = busy;
  ui.power.toggleAttribute('data-busy', busy);
  ui.power.toggleAttribute('data-error', state.status === 'error');

  if (state.status !== lastStatus) {
    ui.status.textContent = STATUS_LABEL[state.status];
    ui.status.dataset['status'] = state.status;
    // Nothing "changed" on the very first paint, so do not animate it.
    if (lastStatus !== null) {
      settle(ui.status);
      if (on) ripple();
    }
    lastStatus = state.status;
  }

  // Mid-flight the slot goes quiet — the spinner is already saying it, and
  // "click to connect" would be a lie. A failure hands the slot to the message.
  ui.readout.dataset['view'] = READOUT_VIEW[state.status];
  ui.endpoint.textContent = state.address
    ? `${state.address.host}:${String(state.address.port)}`
    : '';
  ui.sent.textContent = formatBytes(state.stats.bytesSent);
  ui.received.textContent = formatBytes(state.stats.bytesReceived);
  ui.tunnels.textContent = String(state.stats.activeTunnels);

  ui.error.hidden = state.error === null;
  ui.error.textContent = state.error ?? '';

  // A field only holds an uncommitted value while it has the caret (or an open
  // popup), so skip *that one* control rather than the whole panel — and only
  // while this window really is focused. Blanket-skipping meant toggling
  // "Launch at Login" from the tray left the switch here showing the old value,
  // since a menu click leaves `activeElement` behind in an unfocused document.
  const editing = document.hasFocus() ? document.activeElement : null;

  if (editing !== ui.dnsMode) ui.dnsMode.value = state.settings.dnsMode;
  if (editing !== ui.port) ui.port.value = String(state.settings.port);
  if (editing !== ui.fragmentSize) ui.fragmentSize.value = String(state.settings.fragmentSize);

  // Switches commit on the spot, so there is never anything of the user's to
  // preserve — always show what the main process says.
  ui.tlsRecords.checked = state.settings.tlsRecords;
  ui.systemProxy.checked = state.settings.manageSystemProxy;
  ui.startOnLaunch.checked = state.settings.startOnLaunch;
  ui.launchAtLogin.checked = state.settings.launchAtLogin;

  // Most of these restart the tunnel, so lock them while it is mid-flight.
  for (const control of CONTROLS) control.disabled = busy;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit] ?? 'B'}`;
}

// ── Motion ────────────────────────────────────────────────────────────────

/** A short settle on text that just changed, so the new word registers. */
function settle(node: Element): void {
  if (reduced.matches) return;
  node.animate([{ opacity: 0, translate: '0 4px' }, { opacity: 1 }], {
    duration: 280,
    easing: EASE,
  });
}

/** One ring pushed out of the button the moment the tunnel comes up. */
function ripple(): void {
  if (reduced.matches) return;
  ui.halo.animate(
    [
      { opacity: 0.85, scale: '1' },
      { opacity: 0, scale: '1.55' },
    ],
    {
      duration: 720,
      easing: EASE,
    },
  );
}

// ── Window sizing ─────────────────────────────────────────────────────────
//
// The page is one fixed-width column and the advanced panel is its last
// element, so the window's bottom edge is the only clip in play. Growing the
// window *is* the reveal — see `setContentHeight` in the main process. Nothing
// here animates a height in CSS; two curves would tear against each other.

let requested = 0;
let animateResize = false;

function requestHeight(height: number, animate: boolean): void {
  const rounded = Math.round(height);
  if (rounded === requested) return;
  requested = rounded;
  api.resizeContent(rounded, animate && !reduced.matches);
}

/** Keep the panel short enough that the grown window still fits the display. */
function limitPanel(): void {
  const panel = ui.advanced.hidden ? 0 : ui.advanced.offsetHeight;
  const collapsed = ui.app.offsetHeight - panel;
  const room = window.screen.availHeight - collapsed - 48;
  ui.advanced.style.maxHeight = `${String(Math.max(180, room))}px`;
}

const observer = new ResizeObserver(() => {
  requestHeight(ui.app.offsetHeight, animateResize);
});

// ── Advanced panel ────────────────────────────────────────────────────────

let advancedOpen = false;

function setAdvanced(open: boolean, animate: boolean): void {
  advancedOpen = open;
  ui.disclosure.setAttribute('aria-expanded', String(open));

  if (open) {
    // Laid out at full height straight away; the observer above notices and
    // the window grows to uncover it.
    ui.advanced.hidden = false;
    limitPanel();
  } else {
    // Shrink first, unmount after. Hiding the panel up front would leave a
    // void under the note for the whole length of the animation.
    requestHeight(ui.app.offsetHeight - ui.advanced.offsetHeight, animate);
    window.setTimeout(
      () => {
        if (!advancedOpen) ui.advanced.hidden = true;
      },
      animate && !reduced.matches ? COLLAPSE_MS : 0,
    );
  }

  api.setUiState({ advancedOpen: open });
}

// ── Wiring ────────────────────────────────────────────────────────────────

async function update(patch: Partial<AppSettings>): Promise<void> {
  render(await api.updateSettings(patch));
}

function wire(): void {
  ui.power.addEventListener('click', () => {
    const enabled = ui.power.getAttribute('aria-pressed') !== 'true';
    void api.setEnabled(enabled).then(render);
  });

  ui.hide.addEventListener('click', () => {
    api.hideWindow();
  });

  ui.source.addEventListener('click', () => {
    api.openExternal(PROJECT_URL);
  });

  ui.openLogs.addEventListener('click', () => {
    api.openLogs();
  });

  ui.share.addEventListener('click', openShareSheet);

  ui.disclosure.addEventListener('click', () => {
    setAdvanced(!advancedOpen, true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // A sheet is modal and closes itself on Escape. Without this the same key
    // press would also collapse the panel — or hide the whole window — out from
    // under the question the user is still reading.
    if (anySheetOpen()) return;
    if (advancedOpen) setAdvanced(false, true);
    else api.hideWindow();
  });

  ui.dnsMode.addEventListener('change', () => {
    void update({ dnsMode: ui.dnsMode.value as DnsMode });
  });

  bindSwitch(ui.tlsRecords, (tlsRecords) => update({ tlsRecords }));
  bindSwitch(ui.systemProxy, (manageSystemProxy) => update({ manageSystemProxy }));
  bindSwitch(ui.startOnLaunch, (startOnLaunch) => update({ startOnLaunch }));
  bindSwitch(ui.launchAtLogin, (launchAtLogin) => update({ launchAtLogin }));

  // Numbers commit on blur / Enter so we do not restart on every keystroke.
  bindNumber(ui.port, (port) => update({ port }));
  bindNumber(ui.fragmentSize, (fragmentSize) => update({ fragmentSize }));

  api.onStateChanged(render);
  initAdvocacy();
}

function bindSwitch(input: HTMLInputElement, commit: (value: boolean) => Promise<void>): void {
  input.addEventListener('change', () => {
    void commit(input.checked);
  });
}

function bindNumber(input: HTMLInputElement, commit: (value: number) => Promise<void>): void {
  const submit = (): void => {
    const value = Number.parseInt(input.value, 10);
    if (Number.isInteger(value)) void commit(value);
  };

  input.addEventListener('blur', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────

wire();

const { advancedOpen: openAtBoot } = await api.getUiState();
if (openAtBoot) {
  advancedOpen = true;
  ui.advanced.hidden = false;
  ui.disclosure.setAttribute('aria-expanded', 'true');
}

render(await api.getState());
limitPanel();

// Size the window to the real content before it is ever shown, then let the
// observer take over. Late reflows (fonts, an error message) animate.
requestHeight(ui.app.offsetHeight, false);
observer.observe(ui.app);
window.setTimeout(() => {
  animateResize = true;
}, 150);
