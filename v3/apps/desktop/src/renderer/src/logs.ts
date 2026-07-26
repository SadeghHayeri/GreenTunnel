import type { LogEntry, LogLevel } from '../../shared/types.js';

const api = window.greenTunnel;

/**
 * Must match `--row` in logs.css.
 *
 * The whole list is virtual: only the rows in view exist in the DOM, and their
 * position is `index × ROW_HEIGHT`. Every row is therefore exactly this tall —
 * nothing here may wrap, which is why long lines scroll sideways instead.
 */
const ROW_HEIGHT = 18;

/** Rows kept beyond each edge, so a flick does not show empty space. */
const OVERSCAN = 8;

/** Below this distance from the bottom the view is "tailing" and follows new lines. */
const TAIL_SLACK_PX = 6;

/** Fixed columns before the message: padding, time, level, scope and the gaps. */
const TIME_COLUMNS = 12;
const PREFIX_PX = 12 + 10 + 40 + 10 + 68 + 10 + 12;

/** Trim in batches, like the main process ring: a rebuild per line is waste. */
const TRIM_SLACK = 512;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`#${id} is missing or is not a ${type.name}`);
  }
  return found;
}

const ui = {
  toolbar: element('toolbar', HTMLElement),
  level: element('level', HTMLSelectElement),
  filter: element('filter', HTMLInputElement),
  copy: element('copy', HTMLButtonElement),
  save: element('save', HTMLButtonElement),
  clear: element('clear', HTMLButtonElement),
  viewport: element('viewport', HTMLElement),
  canvas: element('canvas', HTMLDivElement),
  rows: element('rows', HTMLDivElement),
  empty: element('empty', HTMLDivElement),
  emptyTitle: element('empty-title', HTMLSpanElement),
  emptyHint: element('empty-hint', HTMLSpanElement),
  tail: element('tail', HTMLButtonElement),
  count: element('count', HTMLElement),
  dropped: element('dropped', HTMLElement),
};

// ── Model ─────────────────────────────────────────────────────────────────

/**
 * One rendered row. An entry with an `Error` becomes several: the message, then
 * a row per stack frame. Flattening here is what keeps every row the same
 * height, which is what makes the virtual list's arithmetic exact.
 */
interface Line {
  readonly entry: LogEntry;
  readonly kind: 'message' | 'stack';
  readonly text: string;
}

let capacity = 5000;
let entries: LogEntry[] = [];
let lines: Line[] = [];
let total = 0;
/** Whether anything has fallen off the front. The count itself is not useful. */
let truncated = false;
let filter = '';
let widest = 0;

function toLines(entry: LogEntry): Line[] {
  const result: Line[] = [{ entry, kind: 'message', text: entry.message }];
  if (entry.stack === undefined) return result;

  // `stack` opens with "Error: <message>", which we have just printed.
  const frames = entry.stack.split('\n');
  const rest = frames[0]?.includes(entry.message) === true ? frames.slice(1) : frames;

  for (const frame of rest) {
    const text = frame.trim();
    if (text !== '') result.push({ entry, kind: 'stack', text: `  ${text}` });
  }
  return result;
}

function matches(entry: LogEntry): boolean {
  if (filter === '') return true;
  return (
    entry.message.toLowerCase().includes(filter) ||
    entry.scope.toLowerCase().includes(filter) ||
    entry.level.includes(filter) ||
    entry.stack?.toLowerCase().includes(filter) === true
  );
}

/** Recompute everything derived from `entries`. Cheap enough at 5k lines. */
function rebuild(): void {
  lines = [];
  total = 0;
  widest = 0;

  for (const entry of entries) {
    const produced = toLines(entry);
    total += produced.length;
    if (!matches(entry)) continue;
    for (const line of produced) {
      lines.push(line);
      if (line.text.length > widest) widest = line.text.length;
    }
  }
}

function append(incoming: readonly LogEntry[]): void {
  entries.push(...incoming);

  if (entries.length > capacity + TRIM_SLACK) {
    entries = entries.slice(entries.length - capacity);
    truncated = true;
    rebuild();
    return;
  }

  for (const entry of incoming) {
    const produced = toLines(entry);
    total += produced.length;
    if (!matches(entry)) continue;
    for (const line of produced) {
      lines.push(line);
      if (line.text.length > widest) widest = line.text.length;
    }
  }
}

// ── The virtual list ──────────────────────────────────────────────────────

interface Row {
  readonly el: HTMLDivElement;
  readonly time: HTMLSpanElement;
  readonly level: HTMLSpanElement;
  readonly scope: HTMLSpanElement;
  readonly text: HTMLSpanElement;
}

const pool: Row[] = [];
let charWidth = 0;
let following = true;
let painting = false;

function createRow(): Row {
  const el = document.createElement('div');
  el.className = 'line';

  const time = document.createElement('span');
  time.className = 'line__time';
  const level = document.createElement('span');
  level.className = 'line__level';
  const scope = document.createElement('span');
  scope.className = 'line__scope';
  const text = document.createElement('span');
  text.className = 'line__text';

  el.append(time, level, scope, text);
  ui.rows.append(el);
  return { el, time, level, scope, text };
}

/**
 * Width of one monospace character, measured once against the real row styles.
 * The canvas is sized from it so the horizontal scrollbar stays put instead of
 * resizing itself to whichever lines happen to be on screen.
 */
function measureCharWidth(): number {
  if (charWidth > 0) return charWidth;

  const probe = createRow();
  probe.el.style.visibility = 'hidden';
  probe.text.textContent = '0'.repeat(100);
  charWidth = probe.text.getBoundingClientRect().width / 100;
  probe.el.remove();

  return charWidth || 7;
}

function fill(row: Row, line: Line): void {
  const { entry } = line;
  const stack = line.kind === 'stack';

  row.el.dataset['level'] = entry.level;
  row.el.dataset['kind'] = line.kind;
  // A stack frame belongs to the line above it, so it repeats no metadata.
  row.time.textContent = stack ? '' : formatTime(entry.time);
  row.level.textContent = stack ? '' : entry.level;
  row.scope.textContent = stack ? '' : shortScope(entry.scope);
  row.text.textContent = line.text;
}

function layout(): void {
  ui.canvas.style.height = `${String(lines.length * ROW_HEIGHT)}px`;
  ui.canvas.style.width = `${String(
    Math.max(ui.viewport.clientWidth, PREFIX_PX + (TIME_COLUMNS + widest) * measureCharWidth()),
  )}px`;
}

function paint(): void {
  const { scrollTop, clientHeight } = ui.viewport;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN);
  const needed = Math.max(0, last - first);

  while (pool.length < needed) pool.push(createRow());
  while (pool.length > needed) pool.pop()?.el.remove();

  for (let index = 0; index < needed; index += 1) {
    const line = lines[first + index];
    const row = pool[index];
    if (line && row) fill(row, line);
  }

  ui.rows.style.transform = `translateY(${String(first * ROW_HEIGHT)}px)`;
}

function schedulePaint(): void {
  if (painting) return;
  painting = true;
  requestAnimationFrame(() => {
    painting = false;
    paint();
  });
}

/** Layout, follow the tail if we were following, repaint, refresh the counters. */
function refresh(): void {
  layout();
  if (following) ui.viewport.scrollTop = ui.viewport.scrollHeight;
  paint();
  updateStatus();
}

function updateStatus(): void {
  const shown = lines.length;
  ui.count.textContent =
    filter === '' ? lineCount(shown) : `${format(shown)} of ${lineCount(total)}`;

  ui.dropped.hidden = !truncated;
  ui.dropped.textContent = `older lines dropped — only the last ${format(capacity)} are kept`;

  const empty = shown === 0;
  ui.empty.hidden = !empty;
  if (empty) {
    const filtering = filter !== '';
    ui.emptyTitle.textContent = filtering ? 'Nothing matches that filter.' : 'Nothing logged yet.';
    ui.emptyHint.textContent = filtering
      ? 'Clear the filter to see everything captured.'
      : 'Set the level to Debug, then reproduce the problem — every connection will appear here.';
  }

  ui.tail.hidden = following || shown === 0;
}

// ── Formatting ────────────────────────────────────────────────────────────

function formatTime(time: number): string {
  const date = new Date(time);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

/**
 * `green-tunnel:app` → `app`, and the engine's own bare scope → `engine`. The
 * prefix is the same on every line, so showing it would only cost width.
 */
function shortScope(scope: string): string {
  if (!scope.startsWith('green-tunnel')) return scope;
  return scope.slice('green-tunnel'.length).replace(/^:/, '') || 'engine';
}

function format(value: number): string {
  return value.toLocaleString();
}

function lineCount(value: number): string {
  return `${format(value)} ${value === 1 ? 'line' : 'lines'}`;
}

/** What Copy and Save produce: exactly what is on screen, one line each. */
function asText(): string {
  return lines
    .map((line) =>
      line.kind === 'stack'
        ? line.text
        : `${formatTime(line.entry.time)}  ${line.entry.level.padEnd(5)}  ${shortScope(
            line.entry.scope,
          ).padEnd(8)}  ${line.text}`,
    )
    .join('\n');
}

/** Say something happened, on the button that did it. */
function flash(button: HTMLButtonElement, label: string): void {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  window.setTimeout(
    () => {
      button.textContent = original;
      button.disabled = false;
    },
    reduced.matches ? 400 : 1100,
  );
}

// ── Wiring ────────────────────────────────────────────────────────────────

function wire(): void {
  ui.viewport.addEventListener('scroll', () => {
    const distance = ui.viewport.scrollHeight - ui.viewport.scrollTop - ui.viewport.clientHeight;
    following = distance <= TAIL_SLACK_PX;
    ui.tail.hidden = following || lines.length === 0;
    schedulePaint();
  });

  ui.tail.addEventListener('click', () => {
    following = true;
    ui.viewport.scrollTop = ui.viewport.scrollHeight;
    ui.tail.hidden = true;
    schedulePaint();
  });

  new ResizeObserver(() => {
    refresh();
  }).observe(ui.viewport);

  ui.level.addEventListener('change', () => {
    // Persisted by the main process like any other setting, and applied to the
    // live logger — changing it never restarts the tunnel.
    api.logs.setLevel(ui.level.value as LogLevel);
  });

  let filterTimer: number | undefined;
  ui.filter.addEventListener('input', () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filter = ui.filter.value.trim().toLowerCase();
      rebuild();
      // Filtering is a new view, not a scroll: land at the newest match.
      following = true;
      refresh();
    }, 120);
  });

  ui.copy.addEventListener('click', () => {
    api.logs.copy(asText());
    flash(ui.copy, 'Copied');
  });

  ui.save.addEventListener('click', () => {
    void api.logs.save(asText()).then((saved) => {
      if (saved) flash(ui.save, 'Saved');
    });
  });

  ui.clear.addEventListener('click', () => {
    // Clearing goes through the main process, which owns the buffer, and comes
    // back as an event — so a second window (or the next snapshot) agrees.
    api.logs.clear();
  });

  api.logs.onAppend((incoming) => {
    append(incoming);
    refresh();
  });

  api.logs.onCleared(() => {
    entries = [];
    truncated = false;
    rebuild();
    following = true;
    refresh();
  });

  document.addEventListener('keydown', (event) => {
    const accel = event.metaKey || event.ctrlKey;

    if (accel && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      ui.filter.focus();
      ui.filter.select();
      return;
    }

    if (event.key !== 'Escape') return;
    if (ui.filter.value !== '') {
      ui.filter.value = '';
      ui.filter.dispatchEvent(new Event('input'));
      return;
    }
    // Through the main process: `window.close()` is ignored for a window the
    // page did not open, which also skips the bounds save on the way out.
    api.logs.close();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────

// Put there by `createLogsWindow`; drives the room the toolbar leaves for the
// macOS traffic lights. Synchronous, so the first paint is already correct.
document.documentElement.dataset['platform'] =
  new URLSearchParams(window.location.search).get('platform') ?? 'unknown';

wire();

const snapshot = await api.logs.snapshot();
capacity = snapshot.capacity;
truncated = snapshot.dropped > 0;
entries = [...snapshot.entries];
ui.level.value = snapshot.level;

rebuild();
refresh();
