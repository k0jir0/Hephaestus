/**
 * Hephaestus - 24/7 Autonomous AI Developer Agent
 * Main entry point
 */

import path from 'node:path';
import { config as defaultConfig } from './config.js';
import { acquireDaemonLock, type DaemonLock } from './daemon-lock.js';
import { logger } from './logger.js';
import { HephaestusRuntime } from './runtime.js';

const runOnce = process.argv.includes('--once');
const preflightOnly = process.argv.includes('--preflight');
const longRunningMode = !runOnce && !preflightOnly;
const runtime = new HephaestusRuntime();
let daemonLock: DaemonLock | null = null;

async function releaseDaemonLock(): Promise<void> {
  const lock = daemonLock;
  daemonLock = null;
  if (!lock) {
    return;
  }

  await lock.release();
  logger.info(`Daemon lock released: ${lock.pidFile}`);
}

async function main(): Promise<void> {
  logger.info('='.repeat(50));
  logger.info('Hephaestus v1.0.0 - Starting up...');
  logger.info('='.repeat(50));

  if (longRunningMode) {
    const pidFile = process.env.HEPHAESTUS_DAEMON_PID_FILE ||
      path.join(defaultConfig.baseDir, 'run', 'hephaestus-daemon.pid');
    daemonLock = await acquireDaemonLock({ pidFile });
    logger.info(`Daemon lock acquired: ${daemonLock.pidFile} (PID ${daemonLock.pid})`);
  }

  try {
    await runtime.run({ runOnce, preflightOnly });
  } finally {
    await releaseDaemonLock();
  }
}

async function shutdown(signal: string): Promise<void> {
  let exitCode = 0;
  try {
    await runtime.shutdown(signal);
  } catch (error) {
    logger.error('Error during shutdown', { error: String(error) });
    exitCode = 1;
  }

  try {
    await releaseDaemonLock();
  } catch (error) {
    logger.error('Error releasing daemon lock', { error: String(error) });
    exitCode = 1;
  }

  process.exit(exitCode);
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', async (error) => {
  logger.error('Uncaught exception', { error: String(error) });
  await shutdown('uncaughtException');
});
process.on('unhandledRejection', async (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  await shutdown('unhandledRejection');
});

// Start the agent
main().catch(async (error) => {
  logger.error('Fatal error', { error: String(error) });
  await runtime.shutdown('fatal');
  await releaseDaemonLock();
  process.exit(1);
});
