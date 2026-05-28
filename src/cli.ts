import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const RUN_DIR = path.join(ROOT, 'run');
const LOGS_DIR = path.join(ROOT, 'logs');

const PID_FILES = {
  daemon: path.join(RUN_DIR, 'daemon.pid'),
  ui: path.join(RUN_DIR, 'ui.pid'),
  controlMenu: path.join(RUN_DIR, 'control-menu.pid'),
  ollamaViewer: path.join(RUN_DIR, 'ollama-stream-viewer.pid'),
  tasksViewer: path.join(RUN_DIR, 'tasks-board-viewer.pid'),
} as const;

const LOG_FILES = {
  daemonOut: path.join(LOGS_DIR, 'daemon.out'),
  daemonErr: path.join(LOGS_DIR, 'daemon.err'),
  uiOut: path.join(LOGS_DIR, 'ui.out'),
  uiErr: path.join(LOGS_DIR, 'ui.err'),
} as const;

function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function ensureDirs(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function readPid(pidFile: string): number | null {
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  const rawValue = fs.readFileSync(pidFile, 'utf-8').trim();
  if (!rawValue) {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePidFile(pidFile: string): void {
  if (fs.existsSync(pidFile)) {
    fs.rmSync(pidFile, { force: true });
  }
}

function stopByPidFile(label: string, pidFile: string): void {
  const pid = readPid(pidFile);
  if (pid === null) {
    console.log(`${label}: not running`);
    removePidFile(pidFile);
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`${label}: stale pid (${pid}) removed`);
    removePidFile(pidFile);
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  }

  removePidFile(pidFile);
  console.log(`${label}: stopped (${pid})`);
}

function spawnManagedProcess(
  label: string,
  pidFile: string,
  command: string,
  args: string[],
  outLog: string,
  errLog: string
): void {
  const existingPid = readPid(pidFile);
  if (existingPid !== null && isProcessRunning(existingPid)) {
    console.log(`${label}: already running (${existingPid})`);
    return;
  }

  removePidFile(pidFile);

  const outFd = fs.openSync(outLog, 'a');
  const errFd = fs.openSync(errLog, 'a');

  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  fs.writeFileSync(pidFile, String(child.pid), 'utf-8');
  console.log(`${label}: started (${child.pid})`);
}

function runNpm(args: string[]): number {
  const result = spawnSync(npmExecutable(), args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function openUiBrowser(uiPort: string): void {
  const url = `http://127.0.0.1:${uiPort}/`;
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

async function testHttpHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

function tailFile(filePath: string, lineCount = 60): void {
  if (!fs.existsSync(filePath)) {
    console.log(`File does not exist: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const tail = lines.slice(Math.max(0, lines.length - lineCount));
  console.log(tail.join('\n'));
}

function printHeader(title: string): void {
  console.log('====================================================');
  console.log(`  ${title}`);
  console.log('====================================================');
}

async function prompt(rl: readline.Interface, text: string, defaultValue = ''): Promise<string> {
  if (defaultValue) {
    const value = (await rl.question(`${text} [${defaultValue}]: `)).trim();
    return value || defaultValue;
  }
  return (await rl.question(`${text}: `)).trim();
}

async function pause(rl: readline.Interface): Promise<void> {
  await rl.question('\nPress Enter to continue...');
}

function startStack(): void {
  ensureDirs();
  spawnManagedProcess(
    'daemon',
    PID_FILES.daemon,
    npmExecutable(),
    ['run', 'start:daemon'],
    LOG_FILES.daemonOut,
    LOG_FILES.daemonErr
  );

  spawnManagedProcess(
    'ui',
    PID_FILES.ui,
    npmExecutable(),
    ['run', 'ui'],
    LOG_FILES.uiOut,
    LOG_FILES.uiErr
  );
}

function stopStack(): void {
  stopByPidFile('ui', PID_FILES.ui);
  stopByPidFile('daemon', PID_FILES.daemon);
  stopByPidFile('control menu', PID_FILES.controlMenu);
  stopByPidFile('ollama stream viewer', PID_FILES.ollamaViewer);
  stopByPidFile('TASKS viewer', PID_FILES.tasksViewer);
}

function restartStack(): void {
  stopStack();
  startStack();
}

async function showStatus(uiPort: string, aiBackend: string): Promise<void> {
  const daemonPid = readPid(PID_FILES.daemon);
  const uiPid = readPid(PID_FILES.ui);

  const daemonRunning = daemonPid !== null && isProcessRunning(daemonPid);
  const uiRunning = uiPid !== null && isProcessRunning(uiPid);
  const uiHealthy = await testHttpHealth(`http://127.0.0.1:${uiPort}/health`);
  const ollamaHealthy =
    aiBackend === 'ollama' ? await testHttpHealth('http://127.0.0.1:11434/api/tags') : null;

  printHeader('Hephaestus Stack Status');
  console.log(`Root:           ${ROOT}`);
  console.log(`UI port:        ${uiPort}`);
  console.log(`AI backend:     ${aiBackend}`);
  console.log(`Daemon:         ${daemonRunning ? `running (${daemonPid})` : 'not running'}`);
  console.log(`UI server:      ${uiRunning ? `running (${uiPid})` : 'not running'}`);
  console.log(`UI health:      ${uiHealthy ? 'OK' : 'DOWN'}`);
  if (ollamaHealthy !== null) {
    console.log(`Ollama health:  ${ollamaHealthy ? 'OK' : 'DOWN'}`);
  }
}

async function ticketMenu(rl: readline.Interface): Promise<void> {
  while (true) {
    printHeader('Ticket Operations');
    console.log('1) Create ticket');
    console.log('2) List tickets (all)');
    console.log('3) List pending tickets');
    console.log('4) Show ticket');
    console.log('5) Retry ticket');
    console.log('6) Approve ticket');
    console.log('7) Reject ticket');
    console.log('8) Resume ticket');
    console.log('9) Cancel ticket');
    console.log('10) Supersede ticket');
    console.log('11) Show attempts');
    console.log('12) Render board');
    console.log('13) Metrics');
    console.log('0) Back');

    const choice = await prompt(rl, '\nChoice');
    if (choice === '0') {
      return;
    }

    switch (choice) {
      case '1': {
        const description = await prompt(rl, 'Ticket description');
        if (description) {
          runNpm(['run', 'tickets', '--', 'create', description]);
        }
        break;
      }
      case '2':
        runNpm(['run', 'tickets', '--', 'list', '--status', 'all']);
        break;
      case '3':
        runNpm(['run', 'tickets', '--', 'list', '--status', 'pending']);
        break;
      case '4': {
        const ticketId = await prompt(rl, 'Ticket id');
        if (ticketId) runNpm(['run', 'tickets', '--', 'show', ticketId]);
        break;
      }
      case '5': {
        const ticketId = await prompt(rl, 'Ticket id');
        if (ticketId) runNpm(['run', 'tickets', '--', 'retry', ticketId]);
        break;
      }
      case '6': {
        const ticketId = await prompt(rl, 'Ticket id');
        const reviewer = await prompt(rl, 'Reviewer', 'operator');
        const reason = await prompt(rl, 'Reason', 'Approved from CLI');
        if (ticketId) runNpm(['run', 'tickets', '--', 'approve', ticketId, reviewer, reason]);
        break;
      }
      case '7': {
        const ticketId = await prompt(rl, 'Ticket id');
        const reviewer = await prompt(rl, 'Reviewer', 'operator');
        const reason = await prompt(rl, 'Reason', 'Rejected from CLI');
        if (ticketId) runNpm(['run', 'tickets', '--', 'reject', ticketId, reviewer, reason]);
        break;
      }
      case '8': {
        const ticketId = await prompt(rl, 'Ticket id');
        if (ticketId) runNpm(['run', 'tickets', '--', 'resume', ticketId]);
        break;
      }
      case '9': {
        const ticketId = await prompt(rl, 'Ticket id');
        const reason = await prompt(rl, 'Reason', 'Cancelled from CLI');
        if (ticketId) runNpm(['run', 'tickets', '--', 'cancel', ticketId, reason]);
        break;
      }
      case '10': {
        const ticketId = await prompt(rl, 'Ticket id');
        const reason = await prompt(rl, 'Reason', 'Superseded from CLI');
        if (ticketId) runNpm(['run', 'tickets', '--', 'supersede', ticketId, reason]);
        break;
      }
      case '11': {
        const ticketId = await prompt(rl, 'Ticket id');
        if (ticketId) runNpm(['run', 'tickets', '--', 'attempts', ticketId]);
        break;
      }
      case '12':
        runNpm(['run', 'tickets', '--', 'render-board']);
        break;
      case '13':
        runNpm(['run', 'tickets', '--', 'metrics']);
        break;
      default:
        console.log(`Unknown option: ${choice}`);
    }

    await pause(rl);
  }
}

async function reliabilityMenu(rl: readline.Interface): Promise<void> {
  while (true) {
    printHeader('Reliability and Validation');
    console.log('1) Run preflight');
    console.log('2) Run build');
    console.log('3) Run lint');
    console.log('4) Run tests');
    console.log('5) Run fault harness');
    console.log('6) Run soak harness');
    console.log('7) Publish reliability report');
    console.log('0) Back');

    const choice = await prompt(rl, '\nChoice');
    if (choice === '0') {
      return;
    }

    switch (choice) {
      case '1':
        runNpm(['run', 'preflight']);
        break;
      case '2':
        runNpm(['run', 'build']);
        break;
      case '3':
        runNpm(['run', 'lint']);
        break;
      case '4':
        runNpm(['run', 'test']);
        break;
      case '5':
        runNpm(['run', 'fault-harness']);
        break;
      case '6':
        runNpm(['run', 'soak']);
        break;
      case '7':
        runNpm(['run', 'publish:reliability']);
        break;
      default:
        console.log(`Unknown option: ${choice}`);
    }

    await pause(rl);
  }
}

async function logsMenu(rl: readline.Interface): Promise<void> {
  while (true) {
    printHeader('Log Inspection');
    console.log('1) Tail daemon.out');
    console.log('2) Tail daemon.err');
    console.log('3) Tail ui.out');
    console.log('4) Tail ui.err');
    console.log('0) Back');

    const choice = await prompt(rl, '\nChoice');
    if (choice === '0') {
      return;
    }

    switch (choice) {
      case '1':
        tailFile(LOG_FILES.daemonOut);
        break;
      case '2':
        tailFile(LOG_FILES.daemonErr);
        break;
      case '3':
        tailFile(LOG_FILES.uiOut);
        break;
      case '4':
        tailFile(LOG_FILES.uiErr);
        break;
      default:
        console.log(`Unknown option: ${choice}`);
    }

    await pause(rl);
  }
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(ROOT, '.env') });
  ensureDirs();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const uiPort = process.env.UI_PORT?.trim() || '4181';
  const aiBackend = process.env.AI_BACKEND?.trim() || 'ollama';

  try {
    while (true) {
      printHeader('Hephaestus Operator CLI');
      console.log(`Root: ${ROOT}`);
      console.log(`UI:   http://127.0.0.1:${uiPort}`);
      console.log('');
      console.log('1) Start full stack');
      console.log('2) Stop full stack');
      console.log('3) Restart full stack');
      console.log('4) Show stack status');
      console.log('5) Open UI in browser');
      console.log('6) Ticket operations');
      console.log('7) Run autopilot now');
      console.log('8) Reliability and validation');
      console.log('9) Log inspection');
      console.log('0) Exit');

      const choice = await prompt(rl, '\nChoice');

      switch (choice) {
        case '1':
          startStack();
          await pause(rl);
          break;
        case '2':
          stopStack();
          await pause(rl);
          break;
        case '3':
          restartStack();
          await pause(rl);
          break;
        case '4':
          await showStatus(uiPort, aiBackend);
          await pause(rl);
          break;
        case '5':
          openUiBrowser(uiPort);
          console.log('Opened UI in default browser.');
          await pause(rl);
          break;
        case '6':
          await ticketMenu(rl);
          break;
        case '7':
          runNpm(['run', 'autopilot']);
          await pause(rl);
          break;
        case '8':
          await reliabilityMenu(rl);
          break;
        case '9':
          await logsMenu(rl);
          break;
        case '0':
          return;
        default:
          console.log(`Unknown option: ${choice}`);
          await pause(rl);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
