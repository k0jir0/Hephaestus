import fs from 'node:fs/promises';
import path from 'node:path';

export interface DaemonLock {
  pid: number;
  pidFile: string;
  release(): Promise<void>;
}

export interface DaemonLockOptions {
  pidFile: string;
  pid?: number;
  startedAt?: Date;
  isProcessRunning?: (pid: number) => boolean;
}

interface DaemonLockRecord {
  pid: number;
  startedAt?: string;
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseDaemonLockRecord(raw: string): DaemonLockRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return { pid: Number.parseInt(trimmed, 10) };
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<DaemonLockRecord>;
    const pid = Number(parsed.pid);
    if (Number.isInteger(pid) && pid > 0) {
      return {
        pid,
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function readDaemonLockRecord(pidFile: string): Promise<DaemonLockRecord | null> {
  try {
    return parseDaemonLockRecord(await fs.readFile(pidFile, 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function acquireDaemonLock(options: DaemonLockOptions): Promise<DaemonLock> {
  const pid = options.pid ?? process.pid;
  const startedAt = options.startedAt ?? new Date();
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const pidFile = path.resolve(options.pidFile);

  await fs.mkdir(path.dirname(pidFile), { recursive: true });

  const existingRecord = await readDaemonLockRecord(pidFile);
  if (existingRecord) {
    if (existingRecord.pid !== pid && isProcessRunning(existingRecord.pid)) {
      throw new Error(`Hephaestus daemon is already running under PID ${existingRecord.pid}.`);
    }

    await fs.rm(pidFile, { force: true });
  }

  const handle = await fs.open(pidFile, 'wx').catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    const racedRecord = await readDaemonLockRecord(pidFile);
    if (racedRecord && racedRecord.pid !== pid && isProcessRunning(racedRecord.pid)) {
      throw new Error(`Hephaestus daemon is already running under PID ${racedRecord.pid}.`);
    }

    await fs.rm(pidFile, { force: true });
    return fs.open(pidFile, 'wx');
  });

  await handle.writeFile(
    `${JSON.stringify({ pid, startedAt: startedAt.toISOString() })}\n`,
    'utf-8'
  );
  await handle.close();

  let released = false;
  return {
    pid,
    pidFile,
    async release() {
      if (released) {
        return;
      }

      released = true;
      const record = await readDaemonLockRecord(pidFile);
      if (!record || record.pid === pid) {
        await fs.rm(pidFile, { force: true });
      }
    },
  };
}
