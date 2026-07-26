import type { AdvocacyAction } from '../shared/types.js';
import { JsonStore, asBoolean, asInteger } from './json-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long to wait before each ask, measured from the **previous** one — from
 * the first launch for the first. For someone who opens the app regularly that
 * lands on day 3, day 30 and day 90, and then the list runs out: three asks,
 * ever.
 *
 * Deliberately relative rather than absolute deadlines. Someone who installs
 * the app and does not open it for three months would otherwise have all three
 * milestones come due at once and get every prompt inside a single week, which
 * is precisely the behaviour this schedule exists to avoid.
 */
const PROMPT_DELAYS_MS: readonly number[] = [3 * DAY_MS, 27 * DAY_MS, 60 * DAY_MS];

export interface AdvocacyState {
  /** First launch, ms since epoch. The schedule is seeded from here. */
  readonly firstRunAt: number;
  /** When the last prompt was shown; `null` until there has been one. */
  readonly lastPromptAt: number | null;
  /** How many have been shown. Indexes `PROMPT_DELAYS_MS`. */
  readonly promptsShown: number;
  /** The user starred or shared. They have helped; stop asking. */
  readonly helped: boolean;
  /** The user said "Don't show again". */
  readonly dismissed: boolean;
}

export const DEFAULT_ADVOCACY_STATE: AdvocacyState = {
  firstRunAt: 0,
  lastPromptAt: null,
  promptsShown: 0,
  helped: false,
  dismissed: false,
};

/** Like every other file in `userData`: treat what is on disk as untrusted. */
export function normalizeAdvocacyState(raw: unknown): AdvocacyState {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const timestamp = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

  return {
    // A missing or nonsensical stamp means "starting from now", which resets
    // the schedule rather than firing the whole of it immediately.
    firstRunAt: timestamp(input['firstRunAt']) ?? Date.now(),
    lastPromptAt: timestamp(input['lastPromptAt']),
    promptsShown: asInteger(input['promptsShown'], 0, 0, PROMPT_DELAYS_MS.length),
    helped: asBoolean(input['helped'], DEFAULT_ADVOCACY_STATE.helped),
    dismissed: asBoolean(input['dismissed'], DEFAULT_ADVOCACY_STATE.dismissed),
  };
}

export function createAdvocacyStore(): JsonStore<AdvocacyState> {
  const store = new JsonStore('advocacy', normalizeAdvocacyState);
  // `firstRunAt` defaults to *now*, so the very first launch has to write it
  // down. Without this it would be "now" again on every launch, the elapsed
  // time would never exceed the first delay, and the prompt would never fire.
  store.set({});
  return store;
}

/** Whether the user is due to be asked, right now. */
export function isPromptDue(state: AdvocacyState, now: number): boolean {
  if (state.helped || state.dismissed) return false;

  const delay = PROMPT_DELAYS_MS[state.promptsShown];
  if (delay === undefined) return false;

  // A clock that jumped backwards yields a negative elapsed time, which simply
  // defers the prompt — never a burst of them.
  return now - (state.lastPromptAt ?? state.firstRunAt) >= delay;
}

/**
 * Consume one of the three slots.
 *
 * Called when the prompt is actually put on screen, not when it is decided:
 * a slot the user never saw would be a chance silently spent.
 */
export function markPrompted(store: JsonStore<AdvocacyState>, now: number): void {
  store.set({ promptsShown: store.value.promptsShown + 1, lastPromptAt: now });
}

export function recordAdvocacyAction(
  store: JsonStore<AdvocacyState>,
  action: AdvocacyAction,
): void {
  switch (action) {
    case 'star':
    case 'share':
      store.set({ helped: true });
      break;
    case 'never':
      store.set({ dismissed: true });
      break;
    case 'later':
      // Nothing to record: the slot was already spent by `markPrompted`, so the
      // next one is a schedule away on its own.
      break;
  }
}

export function isAdvocacyAction(value: unknown): value is AdvocacyAction {
  return value === 'star' || value === 'share' || value === 'later' || value === 'never';
}
