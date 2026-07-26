#!/usr/bin/env node
import process from 'node:process';
import {
  DEFAULT_BYPASS,
  Proxy,
  SystemProxy,
  createLogger,
  isSystemProxySupported,
  recoverSystemProxy,
  toError,
} from '@green-tunnel/core';
import { HELP_TEXT, UsageError, parseCliArgs, type RunOptions } from './options.js';
import {
  printBanner,
  printError,
  printNotice,
  printStatus,
  printStopped,
  printStopping,
} from './ui.js';
import { VERSION } from './version.js';

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      printError(error.message);
      printNotice('Run `gt --help` for usage.');
      return 2;
    }
    throw error;
  }

  if (parsed.kind === 'help') {
    console.log(HELP_TEXT);
    return 0;
  }
  if (parsed.kind === 'version') {
    console.log(VERSION);
    return 0;
  }

  return run(parsed.options);
}

async function run(options: RunOptions): Promise<number> {
  const logger = createLogger({ level: options.logLevel });

  // Before anything else: if a previous run was killed without cleaning up, the
  // machine may still be pointed at a dead port. Undo that first — it is the
  // difference between "the internet is broken" and a working machine, and it
  // must happen whether or not this run manages the system proxy at all.
  if (isSystemProxySupported()) {
    try {
      const recovered = await recoverSystemProxy();
      if (recovered) {
        printNotice(
          `Restored the system proxy left behind by a previous run (${String(recovered.entries.length)} ` +
            `${recovered.entries.length === 1 ? 'entry' : 'entries'}).`,
        );
      }
    } catch (error) {
      printError(toError(error).message);
    }
  }

  const proxy = new Proxy(options.proxy, { logger });

  // Without a listener, an emitted `error` would throw out of the event loop.
  proxy.on('error', (error) => {
    logger.error(error.message, error);
  });

  const address = await proxy.start();

  const system = options.systemProxy && isSystemProxySupported() ? new SystemProxy() : undefined;

  if (options.systemProxy && !system) {
    printNotice(`System proxy is not supported on ${process.platform}; configure it manually.`);
  }

  try {
    await system?.enable({ host: address.host, port: address.port, bypass: DEFAULT_BYPASS });
  } catch (error) {
    printNotice(`Could not set the system proxy: ${toError(error).message}`);
  }

  // Whether *we* actually changed the OS — the only thing that makes teardown
  // slow, and the only thing worth reassuring the user about on the way out.
  const managingSystemProxy = system?.active ?? false;

  if (!options.quiet) {
    printBanner();
    printStatus(address, proxy.settings, managingSystemProxy);
  }

  await waitForShutdown(
    async () => {
      // Restore the OS first: leaving the machine pointed at a dead port is the
      // worst possible failure mode.
      let restored = managingSystemProxy;
      await system?.disable().catch((error: unknown) => {
        restored = false;
        printError(`Could not restore the system proxy: ${toError(error).message}`);
        printNotice('Run `gt` again to retry, or clear the proxy in your network settings.');
      });
      await proxy.stop();
      if (!options.quiet) printStopped(restored);
    },
    { managingSystemProxy, quiet: options.quiet },
  );

  return 0;
}

/** How long teardown gets before we stop waiting and exit anyway. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Resolve once the process has been asked to stop and `cleanup` has finished.
 *
 * v2 logged `uncaughtException` and carried on with a half-dead proxy while the
 * OS still pointed at it. Here any fatal condition runs the same teardown.
 *
 * Signals use `process.on`, not `process.once`, on purpose. With `once`, the
 * handler is removed as soon as it fires, so a second Ctrl-C — exactly what an
 * impatient user does while "restoring…" is on screen — hits Node's default
 * SIGINT action and kills the process *mid-restore*, stranding every service
 * the restore had not reached yet. Repeat signals are now absorbed instead.
 */
function waitForShutdown(
  cleanup: () => Promise<void>,
  view: { managingSystemProxy: boolean; quiet: boolean },
): Promise<void> {
  return new Promise<void>((resolve) => {
    let shuttingDown = false;

    const stop = (reason: string): void => {
      if (shuttingDown) {
        // Always printed, even under --quiet: this is the message that keeps an
        // impatient user from killing us mid-restore.
        printNotice(
          view.managingSystemProxy
            ? 'Still restoring your network settings — one moment.'
            : 'Still shutting down — one moment.',
        );
        return;
      }
      shuttingDown = true;
      if (reason !== 'signal') printError(reason);
      if (!view.quiet) printStopping(view.managingSystemProxy);

      // Never hang forever on a wedged `networksetup`/`gsettings` call: the
      // recovery file means the next run can finish the job.
      const timer = setTimeout(() => {
        printError('Teardown timed out.');
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
      timer.unref();

      void cleanup().finally(() => {
        clearTimeout(timer);
        resolve();
      });
    };

    // SIGHUP matters as much as SIGINT here: closing the terminal window is a
    // completely ordinary way to stop a foreground CLI, and v3.0 ignored it —
    // Node's default action killed the process with the proxy still set.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => {
        stop('signal');
      });
    }
    process.once('uncaughtException', (error) => {
      stop(`Fatal error: ${toError(error).message}`);
    });
    process.once('unhandledRejection', (error) => {
      stop(`Unhandled rejection: ${toError(error).message}`);
    });
  });
}

try {
  process.exitCode = await main();
} catch (error) {
  const failure = toError(error);
  printError(
    (failure as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? 'That port is already in use — pick another with --port.'
      : failure.message,
  );
  process.exitCode = 1;
}
