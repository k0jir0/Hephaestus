import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { acquireDaemonLock } from '../src/daemon-lock.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hephaestus-daemon-lock-'));
}

describe('daemon lock', () => {
  it('refuses to acquire a lock held by a running process', async () => {
    const dir = await makeTempDir();
    const pidFile = path.join(dir, 'hephaestus-daemon.pid');
    await fs.writeFile(pidFile, JSON.stringify({ pid: 1234 }), 'utf-8');

    try {
      await assert.rejects(
        acquireDaemonLock({
          pidFile,
          pid: 5678,
          isProcessRunning: (pid) => pid === 1234,
        }),
        /already running under PID 1234/
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('replaces a stale lock and releases its own pid file', async () => {
    const dir = await makeTempDir();
    const pidFile = path.join(dir, 'hephaestus-daemon.pid');
    await fs.writeFile(pidFile, JSON.stringify({ pid: 1234 }), 'utf-8');

    try {
      const lock = await acquireDaemonLock({
        pidFile,
        pid: 5678,
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
        isProcessRunning: () => false,
      });

      const raw = await fs.readFile(pidFile, 'utf-8');
      assert.equal(JSON.parse(raw).pid, 5678);

      await lock.release();
      await assert.rejects(fs.stat(pidFile), /ENOENT/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not release a lock that has been replaced by another daemon', async () => {
    const dir = await makeTempDir();
    const pidFile = path.join(dir, 'hephaestus-daemon.pid');

    try {
      const lock = await acquireDaemonLock({
        pidFile,
        pid: 5678,
        isProcessRunning: () => false,
      });
      await fs.writeFile(pidFile, JSON.stringify({ pid: 9999 }), 'utf-8');

      await lock.release();

      const raw = await fs.readFile(pidFile, 'utf-8');
      assert.equal(JSON.parse(raw).pid, 9999);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
