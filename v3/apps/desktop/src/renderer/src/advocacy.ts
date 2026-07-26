/**
 * The two sheets: "Share Green Tunnel", and the occasional ask for a star.
 *
 * Both are `<dialog>` elements opened with `showModal()`, which puts them in the
 * top layer — out of `#app`'s flow, so neither one perturbs the height the
 * window is sized to. That is the whole reason they are dialogs and not cards
 * in the column: growing the window *is* how the advanced panel is revealed,
 * and a sheet that changed that height would fight it.
 *
 * When to ask is not decided here. The main process owns the schedule, because
 * it owns the file that outlives the window; this module only renders the
 * question and reports the answer.
 */

import { PROJECT_URL, SHARE_TARGETS, type ShareTargetId } from '../../shared/share.js';
import type { AdvocacyAction } from '../../shared/types.js';

const api = window.greenTunnel;

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`#${id} is missing or is not a ${type.name}`);
  }
  return found;
}

const ui = {
  shareSheet: element('share-sheet', HTMLDialogElement),
  shareClose: element('share-close', HTMLButtonElement),
  prompt: element('advocacy', HTMLDialogElement),
  star: element('advocacy-star', HTMLButtonElement),
  share: element('advocacy-share', HTMLButtonElement),
  later: element('advocacy-later', HTMLButtonElement),
  never: element('advocacy-never', HTMLButtonElement),
};

/**
 * The answer the user gave, held only until the dialog's `close` fires.
 *
 * Every route out of the prompt ends there — a button, Escape, a click on the
 * backdrop — so recording from `close` is what makes "walked away" mean `later`
 * without a second code path saying so.
 */
let answer: AdvocacyAction | null = null;

export function openShareSheet(): void {
  ui.shareSheet.showModal();
}

/** True while either sheet is up, so Escape elsewhere can stand down. */
export function anySheetOpen(): boolean {
  return ui.shareSheet.open || ui.prompt.open;
}

export function initAdvocacy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-share]')) {
    const id = button.dataset['share'] as ShareTargetId;
    const target = SHARE_TARGETS.find((candidate) => candidate.id === id);
    if (!target) continue;

    button.addEventListener('click', () => {
      api.openExternal(target.href);
      ui.shareSheet.close();
    });
  }

  ui.shareClose.addEventListener('click', () => {
    ui.shareSheet.close();
  });

  ui.star.addEventListener('click', () => {
    api.openExternal(PROJECT_URL);
    close('star');
  });

  ui.share.addEventListener('click', () => {
    // `close()` settles synchronously, so the answer is already recorded by the
    // time the share sheet goes up.
    close('share');
    openShareSheet();
  });

  ui.later.addEventListener('click', () => {
    close('later');
  });

  ui.never.addEventListener('click', () => {
    close('never');
  });

  ui.prompt.addEventListener('close', () => {
    api.recordAdvocacy(answer ?? 'later');
    answer = null;
  });

  lightDismiss(ui.shareSheet);
  lightDismiss(ui.prompt);

  api.onAdvocacyPrompt(() => {
    if (!ui.prompt.open) ui.prompt.showModal();
  });
}

function close(action: AdvocacyAction): void {
  answer = action;
  ui.prompt.close();
}

/**
 * Close a sheet when the click landed outside it.
 *
 * A modal dialog's backdrop retargets its clicks to the dialog element itself,
 * so `target === dialog` says "not on any of the contents" — which is also what
 * excludes a keyboard-activated child button, whose click reports coordinates
 * of 0,0 and would otherwise read as a click in the far corner.
 */
function lightDismiss(dialog: HTMLDialogElement): void {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;

    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;

    if (outside) dialog.close();
  });
}
